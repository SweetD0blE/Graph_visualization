# extra_data_generator.py
import pandas as pd
import json
import os

rus = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
lat = ['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','kh','ts','ch','sh','shch','','y','','e','yu','ya']
trans = {r: l for r, l in zip(rus, lat)}
trans.update({r.upper(): l.upper() for r, l in zip(rus, lat)})

def translit(s):
    return ''.join(trans.get(ch, ch) for ch in s)

def make_id(name):
    fam = name.split()[0]
    return translit(fam).lower()

def collect_people(df):
    people = {}
    def add(name):
        pid = make_id(name)
        if pid not in people:
            people[pid] = {
                "id": pid,
                "label": name,
                "imgExists": os.path.isfile(f"img/{pid}.jpg")
            }
    for s in df['Отправитель'].dropna().unique():
        add(s)
    for recs in df['Список получателей'].dropna():
        for r in [r.strip() for r in recs.split(',') if r.strip()]:
            add(r)
    return people

def main(input_excel='sample.xlsx', output_js='extra_data.js'):
    df = pd.read_excel(input_excel)
    people = collect_people(df)

    extra = {}
    for _, row in df.iterrows():
        tag = translit(row['Тег']).replace(' ', '_').lower()
        cat = translit(str(row['Категория'])).replace(' ', '_').lower()

        extra.setdefault(tag, {'nodes': [], 'edges': []})

        receivers = [r.strip() for r in str(row['Список получателей']).split(',') if r.strip()]
        for rec in receivers:
            pid = make_id(rec)
            if not any(n['id'] == pid for n in extra[tag]['nodes']):
                node = {
                    'id': pid,
                    'label': people[pid]['label'],
                    'type': 'person'
                }
                if people[pid]['imgExists']:
                    node['img'] = f"img/{pid}.jpg"
                extra[tag]['nodes'].append(node)

        for rec in receivers:
            pid = make_id(rec)
            extra[tag]['edges'].append({
                'source': tag,
                'target': pid,
                'label': 1,
                'details': {
                    'link': row['Ссылка'],
                    'registration_number': row['Номер регистрации'],
                    'system_number': row['Системный номер'],
                    'reg_date': str(row['Дата регистрации']),
                    'update_date': str(row['Дата обновления']),
                    'content': row['Содержание'],
                    'sender': row['Отправитель'],
                    'receivers': receivers,
                    'authors': row['Авторы'],
                    'receivers_count': int(row['Количество получателей']),
                    'privacy': row['Приватность'],
                    'doc_type': row['Вид документа'],
                    'doc_category': row['Тип документа'],
                    'urgency': row['Срочность'],
                    'stage': row['Этап'],
                    'tag': row['Тег'],
                    'category': row['Категория']
                }
            })

    with open(output_js, 'w', encoding='utf-8') as f:
        f.write('window.extraData = ')
        json.dump(extra, f, ensure_ascii=False, indent=2)
        f.write(';')
    print(f"-> {output_js} создан.")

if __name__ == '__main__':
    main()
