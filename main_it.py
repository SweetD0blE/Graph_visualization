import sys
import os
import json
import statistics
import pdfplumber
import fitz  # PyMuPDF
import pandas as pd
from collections import defaultdict, Counter
from datetime import datetime

from PyQt5.QtWidgets import (
    QApplication,
    QWidget,
    QPushButton,
    QLabel,
    QVBoxLayout,
    QFileDialog,
    QMessageBox,
)
from PyQt5.QtCore import Qt

# -----------ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ-------------


def esure_dir(path: str):
    os.makedirs(path, exist_ok=True)
    return path


def normalize_header(s):
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\n", " ").replace("\r", " ")
    s = " ".join(s.split())
    return s.strip()


def normalize_cell(s):
    if s is None:
        return ""
    s = str(s).replace("\xa0", " ").strip()
    # Убираем лишние переносы
    s = " ".join(s.split())
    return s


def try_parse_number(s):
    x = s.replace(" ", "").replace("\u00a0", "")
    if "," in x and "." not in x:
        x = x.replace(",", ".")
    try:
        return float(x)
    except Exception:
        return s


def headers_equal(h1, h2):
    if len(h1) != len(h2):
        return False
    a = [normalize_header(x).lower() for x in h1]
    b = [normalize_header(x).lower() for x in h2]
    return a == b


def detect_columns(words, gap_factor=1.7, min_col_width=40):
    """
    Группируем слова в колонки по Х-координате
    Идея: берём xcenter слов, сортируем, ищем "провалы" между соседями.
    """
    if not words:
        return []

    # xcenter каждого слова
    xcenters = sorted([(w["x0"] + w["x1"]) / 2.0 for w in words])
    # расстояния между соседними словами
    gaps = [xcenters[i + 1] - xcenters[i] for i in range(len(xcenters) - 1)]
    if not gaps:
        # одна колонка
        xs = [w["x0"] for w in words]
        xe = [w["x1"] for w in words]
        return [(max(min(xs), 0), max(xe))]

    # Медианный "обычный" зазор между соседями
    med_gap = statistics.median(gaps) if gaps else 0
    # Порог: "большие провалы" -> границы колонок
    threshold = med_gap * gap_factor

    splits = []
    current = [xcenters[0]]
    for i, g in enumerate(gaps):
        if g > max(threshold, min_col_width):
            # Новая колонка
            splits.append((current[0], current[-1]))
            current = []
        current.append(xcenters[i + 1])
    if current:
        splits.append((current[0], current[-1]))

    # Преобразуем в x0...x1 по фактическим словам
    cols = []
    for xc0, xc1 in splits:
        lefts = []
        rights = []
        for w in words:
            xc = (w["x0"] + w["x1"]) / 2.0
            if xc - 1e-3 <= xc <= xc1 + 1e-3:
                lefts.append(w["x0"])
                rights.append(w["x1"])
        if lefts and rights:
            cols.append((min(lefts), max(rights)))
    # Отсортируем по x0
    cols.sort(key=lambda x: x[0])
    return cols


def extract_text_by_columns(page, y_tolerance=2.0):
    """
    Реконструкция много-колоночного текста:
    - Слова -> колонки -> строки внутри колонки
    """
    words = (
        page.extract_words(
            keep_blank_chars=False,
            use_text_flow=True,
            extra_attrs=["fontname", "size"],
        )
        or []
    )

    if not words:
        return ""

    cols = detect_columns(words)
    if not cols:
        cols = [(0, page.width)]

    column_texts = []
    for x0, x1 in cols:
        col_words = [w for w in words if w["x0"] >= x0 - 0.5 and w["x1"] <= x1 + 0.5]
        # сортируем по Y, затем по X
        col_words.sort(key=lambda w: (round(w["top"], 1), w["x0"]))

        # группируем слова в строки
        lines = []
        current_line_y = None
        current_line = []
        for w in col_words:
            y = w["top"]
            if current_line_y is None:
                current_line_y = y
                current_line = [w]
                continue
            if abs(y - current_line_y) <= y_tolerance:
                current_line.append(w)
            else:
                # закрываем строку
                current_line.sort(key=lambda z: z["x0"])
                line_text = " ".join([z["text"] for z in current_line])
                lines.append(line_text)
                # новая строка
                current_line_y = y
                current_line = [w]
        # последняя строка
        if current_line:
            current_line.sort(key=lambda z: z["x0"])
            line_text = " ".join([z["text"] for z in current_line])
            lines.append(line_text)

        column_texts.append("\n".join(lines))
    return ("\n\n".join(column_texts)).strip()


def evaluate_table(df: pd.DataFrame):
    """
    Простейшая метрика качества для выбора лучшего извлечения:
    - доля непустых ячеек
    - стандартное отклонение ширины текстов по столбцам (меньше - лучше)
    """
    if df is None or df.empty:
        return 0.0

    # Непустые
    total = df.size
    non_empty = df.map(lambda x: bool(str(x).strip())).values.sum()
    density = non_empty / (total if total else 1)

    # шум по длинам
    col_widths = []
    for col in df.columns:
        lengths = [len(str(v)) for v in df[col].tolist()]
        if lengths:
            col_widths.append(statistics.pstdev(lengths))
    # Чем меньше шум, тем лучше
    stability = 1.0 / (1.0 + (statistics.mean(col_widths) if col_widths else 0.0))

    return 0.6 * density + 0.4 * stability


def extract_tables_multi_stategy(page):
    """
    Пробуем lattice и stream, возвращаем список лучших таблиц (как DataFrame).
    """
    results = []

    lattice_settings = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "intersection_tolerance": 5,
        "snap_tolerance": 3,
        "edge_min_length": 3,
        "min_words_vertical": 1,
        "min_words_horizontal": 1,
        "join_tolerance": 3,
        "text_tolerance": 3,
    }

    stream_settings = {
        "vertical_strategy": "text",
        "horizontal_strategy": "text",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "text_tolerance": 3,
        "x_tolerance": 2,
        "y_tolerance": 2,
        "min_words_vertical": 1,
        "min_words_horizontal": 1,
    }

    table_objs = []
    try:
        table_objs += page.find_tables(table_settings=lattice_settings)
    except Exception:
        pass
    try:
        table_objs += page.find_tables(table_settings=stream_settings)
    except Exception:
        pass

    for t in table_objs:
        try:
            raw = t.extract()
            if not raw or len(raw) < 2:
                continue
            header = [normalize_header(c) for c in raw[0]]
            rows = [[normalize_cell(c) for c in r] for r in raw[1:]]
            df = pd.DataFrame(rows, columns=header)
            score = evaluate_table(df)
            results.append((df, score, t.bbox))
        except Exception:
            continue

    # Удаляем дубликаты по bbox и структуре
    uniq = []
    seen = set()
    for df, score, bbox in results:
        key = (
            tuple(df.columns),
            tuple(df.dtypes.astype(str)),
            tuple(map(lambda x: round(x, 1), bbox)),
        )
        if key in seen:
            continue
        seen.add(key)
        uniq.append((df, score, bbox))

    # Сортируем по score
    uniq.sort(key=lambda x: x[1], reverse=True)
    return uniq


def append_or_new_sheet(writer, sheet_name, df):
    """
    Пишет DataFrame в лист Excel. Если лист существует, дописывает ниже
    (создаёт *_part2, если несовместимо по колонкам)
    """
    # openpyxl позволяет читать существующий лист только если файл уже есть на диске,
    # но мы пишем в контексте одного writer. Поддержим простую схему имен.
    base_name = sheet_name
    name = base_name
    n = 1
    while name in writer.sheets:
        existing_df = None
        n += 1
        name = f"{base_name}_part{n}"

    df.to_excel(writer, sheet_name=name, index=False)


# -----------ОСНОВНОЕ ПРИЛОЖЕНИЕ-------------


class PDFParserApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PDF Parser")
        self.resize(640, 200)

        self.file_path = None

        self.layout = QVBoxLayout()

        self.load_btn = QPushButton("Загрузить PDF-файл")
        self.load_btn.clicked.connect(self.load_file)
        self.layout.addWidget(self.load_btn)

        self.path_label = QLabel("Файл не выбран")
        self.path_label.setAlignment(Qt.AlignCenter)
        self.layout.addWidget(self.path_label)

        self.process_btn = QPushButton("Обработать файл")
        self.process_btn.setEnabled(False)
        self.process_btn.clicked.connect(self.process_file)
        self.layout.addWidget(self.process_btn)

        self.setLayout(self.layout)

    def load_file(self):
        options = QFileDialog.Options()
        file_name, _ = QFileDialog.getOpenFileName(
            self,
            "Выберите PDF-файл",
            "",
            "PDF Files (*.pdf);;All Files (*)",
            options=options,
        )
        if file_name:
            if not file_name.lower().endswith(".pdf"):
                QMessageBox.warning(self, "Ошибка", "Выберите файл с расширением .pdf")
                return
            self.file_path = file_name
            self.path_label.setText(f"Выбран файл:\n{self.file_path}")
            self.process_btn.setEnabled(True)

    def process_file(self):
        try:
            self.process_btn.setEnabled(False)
            self.path_label.setText("Обработка... Пожалуйста, подождите.")
            QApplication.processEvents()  # Обновить UI

            output_dir = self.prepare_output_dir(self.file_path)
            text_path = os.path.join(output_dir, "text.txt")
            tables_xlsx_path = os.path.join(output_dir, "tables.xlsx")
            images_dir = os.path.join(output_dir, "images")
            os.makedirs(images_dir, exist_ok=True)

            # ----------- ТЕКСТ И ТАБЛИЦЫ -------------
            with pdfplumber.open(self.file_path) as pdf:
                total_pages = len(pdf.pages)

                all_text = []
                tables_collected = []

                prev_best_headers = None
                page_stats = []

                for page_num, page in enumerate(pdf.pages, start=1):
                    if page.rotation in [90, 270]:
                        page = page.rotate(-page.rotation)

                    page_text = extract_text_by_columns(page)
                    if not page_text:
                        page_text = (page.extract_text() or "").strip()

                    all_text.append(f"=== СТРАНИЦА {page_num} ===\n{page_text}\n\n")

                    # Таблицы
                    extracted = extract_tables_multi_stategy(page)
                    best_count = 0
                    for idx, (df, score, bbox) in enumerate(extracted):
                        df = df.map(normalize_cell)
                        df = df.map(
                            lambda v: try_parse_number(v) if isinstance(v, str) else v
                        )

                        headers = list(df.columns)
                        merged = False
                        if prev_best_headers is not None and headers_equal(
                            headers, prev_best_headers
                        ):
                            tables_collected.append(
                                (df, page_num, bbox, score, "append")
                            )
                            merged = True
                        else:
                            tables_collected.append((df, page_num, bbox, score, "new"))
                            prev_best_headers = headers

                        best_count += 1

                    # Статистика страницы
                    words_cnt = len(page.extract_words() or [])
                    page_stats.append(
                        {
                            "page": page_num,
                            "words": words_cnt,
                            "tables_found": len(extracted),
                            "likely_scanned": (words_cnt < 5 and len(extracted) == 0),
                        }
                    )

            # Сохранение текста
            with open(text_path, "w", encoding="utf-8") as f:
                f.writelines(all_text)

            # ----------- ИЗОБРАЖЕНИЯ -------------
            doc = fitz.open(self.file_path)
            image_count = 0
            for page_index in range(len(doc)):
                page = doc[page_index]
                image_list = page.get_images(full=True)
                for _, img in enumerate(image_list, start=1):
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    ext = base_image.get("ext", "png")
                    image_count += 1
                    image_path = os.path.join(
                        images_dir, f"page{page_index+1:03d}_img{image_count:04d}.{ext}"
                    )
                    with open(image_path, "wb") as img_file:
                        img_file.write(image_bytes)

            # -----------EXCEL ВЫВОД -------------
            if tables_collected:
                with pd.ExcelWriter(tables_xlsx_path, engine="openpyxl") as writer:
                    summary_rows = []
                    for i, (df, p, bbox, score, mode) in enumerate(
                        tables_collected, start=1
                    ):
                        sheet_name = f"Таблица_{i:02d}"
                        append_or_new_sheet(writer, sheet_name, df)
                        summary_rows.append(
                            {
                                "sheet": sheet_name,
                                "page": p,
                                "mode": mode,
                                "score": round(score, 3),
                                "bbox": str(tuple(round(x, 1) for x in bbox)),
                                "rows": int(df.shape[0]),
                                "cols": int(df.shape[1]),
                                "headers": " | ".join(
                                    [normalize_header(h) for h in df.columns]
                                ),
                            }
                        )
                    pd.DataFrame(summary_rows).to_excel(
                        writer, sheet_name="Summary", index=False
                    )

            # ----------- META -------------
            meta = {
                "file_name": os.path.basename(self.file_path),
                "total_pages": len(doc),
                "images_extracted": image_count,
                "output_dir": output_dir,
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "page_stats": page_stats,
            }
            meta_path = os.path.join(output_dir, "meta.json")
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=4, ensure_ascii=False)

            QMessageBox.information(
                self,
                "Готово",
                f"Парсинг завершен!\n\nРезультаты сохранены в:\n{output_dir}",
            )
            self.path_label.setText("Файл не выбран")
            self.file_path = None

        except Exception as e:
            QMessageBox.critical(self, "Ошибка", f"Произошла ошибка:\n{str(e)}")
            self.process_btn.setEnabled(True)
            if self.file_path:
                self.path_label.setText(f"Выбран файл:\n{self.file_path}")

    def prepare_output_dir(self, file_path):
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        output_root = os.path.join(os.getcwd(), "output")
        os.makedirs(output_root, exist_ok=True)
        output_dir = os.path.join(output_root, base_name)
        if os.path.exists(output_dir):
            # Если папка уже есть — очищаем
            import shutil

            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)
        return output_dir


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = PDFParserApp()
    window.show()
    sys.exit(app.exec())
