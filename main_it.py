import sys
import os
import json
import shutil
import pdfplumber
import fitz  # PyMuPDF
import pandas as pd

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


class PDFParserApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PDF Парсер")
        self.resize(600, 180)

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
        file_name, _ = QFileDialog.getOpenFileName(
            self, "Выберите PDF-файл", "", "PDF-файлы (*.pdf);;Все файлы (*)"
        )
        if file_name:
            if not file_name.lower().endswith(".pdf"):
                QMessageBox.warning(self, "Ошибка", "Выберите PDF-файл")
                return
            self.file_path = file_name
            self.path_label.setText(f"Выбран файл:\n{self.file_path}")
            self.process_btn.setEnabled(True)

    def process_file(self):
        try:
            self.process_btn.setEnabled(False)
            self.path_label.setText("Обработка... Пожалуйста, подождите.")
            QApplication.processEvents()

            output_dir = self.prepare_output_dir(self.file_path)
            images_dir = os.path.join(output_dir, "images")
            os.makedirs(images_dir, exist_ok=True)

            meta = {
                "filename": os.path.basename(self.file_path),
                "pages_total": 0,
                "tables_found": 0,
                "images_found": 0,
                "page_stats": [],
            }

            all_text = []

            def extract_text_excluding_tables(page):
                import math

                table_bboxes = [tbl.bbox for tbl in page.find_tables()]

                chars = []
                for char in page.chars:
                    x0, y0, x1, y1 = char["x0"], char["top"], char["x1"], char["bottom"]
                    inside_table = False
                    for tx0, ty0, tx1, ty1 in table_bboxes:
                        if tx0 <= x0 <= tx1 and ty0 <= y0 <= ty1:
                            inside_table = True
                            break
                    if not inside_table:
                        chars.append(char)

                lines = {}
                threshold_y = 3
                for ch in chars:
                    y = ch["top"]
                    line_key = None
                    for key in lines:
                        if abs(key - y) < threshold_y:
                            line_key = key
                            break
                    if line_key is None:
                        line_key = y
                        lines[line_key] = []
                    lines[line_key].append(ch)

                sorted_lines = sorted(lines.items(), key=lambda x: x[0])

                result_lines = []
                space_threshold = 2
                for _, line_chars in sorted_lines:
                    line_chars = sorted(line_chars, key=lambda c: c["x0"])
                    line_text = []
                    last_x1 = None
                    for ch in line_chars:
                        if last_x1 is not None:
                            gap = ch["x0"] - last_x1
                            if gap > space_threshold:
                                line_text.append(" ")
                        line_text.append(ch["text"])
                        last_x1 = ch["x1"]
                    result_lines.append("".join(line_text).rstrip())

                return "\n".join(result_lines).strip()

            # — Обработка текста и таблиц —
            with pdfplumber.open(self.file_path) as pdf:
                meta["pages_total"] = len(pdf.pages)

                with pd.ExcelWriter(
                    os.path.join(output_dir, "tables.xlsx"), engine="openpyxl"
                ) as writer:
                    for i, page in enumerate(pdf.pages, start=1):
                        page_text = extract_text_excluding_tables(page)
                        all_text.append(f"=== СТРАНИЦА {i} ===\n{page_text}\n\n")

                        tables = page.extract_tables()
                        meta["tables_found"] += len(tables)

                        page_tables = []
                        for table in tables:
                            df = pd.DataFrame(table[1:], columns=table[0])
                            page_tables.append(df)

                        # Если есть таблицы — сохраняем их на лист Page_i
                        if page_tables:
                            sheet_name = f"Page_{i}"
                            start_row = 0
                            for df in page_tables:
                                df.to_excel(
                                    writer,
                                    sheet_name=sheet_name,
                                    startrow=start_row,
                                    index=False,
                                )
                                start_row += len(df) + 2  # добавляем отступ

                        meta["page_stats"].append(
                            {
                                "page": i,
                                "text_chars": len(page_text),
                                "tables": len(tables),
                                "images": 0,  # позже заполним
                            }
                        )

                # Сохраняем текст
                text_path = os.path.join(output_dir, "text.txt")
                with open(text_path, "w", encoding="utf-8") as f:
                    f.writelines(all_text)

                # — Извлечение изображений —
                doc = fitz.open(self.file_path)
                image_count = 0
                for page_index in range(len(doc)):
                    page = doc[page_index]
                    image_list = page.get_images(full=True)
                    image_count += len(image_list)

                    for img_index, img in enumerate(image_list, start=1):
                        xref = img[0]
                        base_image = doc.extract_image(xref)
                        ext = base_image["ext"]
                        image_data = base_image["image"]
                        image_name = f"image_page{page_index + 1}_{img_index}.{ext}"
                        image_path = os.path.join(images_dir, image_name)
                        with open(image_path, "wb") as img_file:
                            img_file.write(image_data)

                    if page_index < len(meta["page_stats"]):
                        meta["page_stats"][page_index]["images"] = len(image_list)

                meta["images_found"] = image_count

                # — Сохраняем meta.json —
                meta_path = os.path.join(output_dir, "meta.json")
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=4, ensure_ascii=False)

                QMessageBox.information(
                    self,
                    "Готово",
                    f"Парсинг завершён!\n\nРезультаты сохранены в:\n{output_dir}",
                )
                self.path_label.setText("Файл не выбран")
                self.file_path = None

        except Exception as e:
            QMessageBox.critical(self, "Ошибка", f"Произошла ошибка:\n{str(e)}")
        self.process_btn.setEnabled(True)
        self.path_label.setText(f"Выбран файл:\n{self.file_path}")

    def prepare_output_dir(self, file_path):
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        output_root = os.path.join(os.getcwd(), "output")
        os.makedirs(output_root, exist_ok=True)
        output_dir = os.path.join(output_root, base_name)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)
        return output_dir


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = PDFParserApp()
    window.show()
    sys.exit(app.exec())
