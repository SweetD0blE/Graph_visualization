# Graph_visualization
Интерактивная визуализация документооборота
Динамическая граф-визуализация потоков документов: **Отправитель -> Категория -> Тег -> Получатели**.
Реализовано на чистом JavaScript и D3.js v7, данные парсятся из Excel.

---

## Основные возможности
- **Поиск по отправителю**
  Введите фамилию и инициалы (например, "Терентьев И.О."), выберите за какой период найти документы, и  нажмите **Найти** - граф сразу строится вокруг выбранного отправителя

- **Иерархическая структура**
  1. **Отправитель** - центральный фиксированный узел
  2. **Категория** - объединяющая группа тегов (например, "Законодательство", "Отчётность" и проч.)
  3. **Тег** - тема или ключевое слово документа
  4. **Получатели** - узлы появляются вокруг раскрытого тега
 
- **Фильтрация по дате**
  Быстрый выбор периода: 7 дней, 1 месяц, 3 месяца, 6 месяцев, 9 месяцев, 1 год, 2 года или "Всё время".

- **Инкрементальное раскрытие**
  Двойной клик по узлу **тега** добавляет соответствующух получателей в текущую карту, не сбрасывая уже расставленные узлы и текущий зум/панорамирование.

- **Drag & Drop**
  - **Категории** и **раскрытые узлы** "прилипают" к месту, куда вы их перетащили, для удобства анализа.
  - Остальные узлы остаются динамическими и реагируют на силы симуляции.
 
- **Zoom & Pan**
  Колёсико мыши, тачпад или перетаскивание для навигации по карте.

- **Панель деталей**
  При клике на связь (линия) или цифру "1" рядом с ней - открываются подробные метаданные документа:
  - Ссылка
  - Регистрационный номер
  - Системный номер
  - Дата регистрации / обновления
  - Содержание, Тип, Категория, Срочность, Этап и т.д.
 
- **Производительность**
  Оптимизировано для работы с большими массивами: протестировано на > 13 000 строк Excel, используется инкрементальное обновление D3.

---

## Технологии

- **JavaScript (ES6+)** - логика построения и управления графом
- **D3.js v7** - силовая симуляция, рендеринг SVG, зум/пан
- **HTML5 & CSS3** - структура и стили интерфейса
- **Excel -> JSON** - (Python-скрипт) - парсинг исходных данныхЮ генерация `graph_data.json` и `etra_data.js`

---

## Установка и запуск
1. **Клонировать репозиторий**
   ```bash
   git clone https://github.com/SweetD0blE/Graph_visualization.git
2. **Загрузить в проект свой xlsx файл**
   Далее в терминале написать команду:
   `python main.py`
   После этого создаются два файла
   - graph_data.json (с узлами/связями)
   - extra_data.js (подробности по каждому тегу)
3. **Проверить структуру**
   - index.html
   - style.css
   - script.js
   - graph_data.json (с узлами/связями)
   - extra_data.js (подробности по каждому тегу)
   - img(если имеются фотографии Отправителя или получателей для визуала)
4. **Работать с данными**
   Запустите локальный сервер:
   `python http.server 8000`
   После этого перейдите в браузере на http://localhost:8000 и начинайте исследовать граф!

## Дальнейшее развитие
1. Добавить группировку узлов или кластеризацию для сверхбольших графов.
2. Фильтрация по дополнительным метаданным (авторы, срочность и т.п.)
3. Экспорт текущего вида графа в PNG/SVG или PDF
4. Тёмная тема, настройки цвета/размера узлов по типам документов



**Автор** Илья, эксперт по цифровым технологиям аудита
**Лицензия** MIT
