# graph_data_generator.py
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
    return people

def main(input_excel='sample.xlsx', output_json='graph_data.json'):
    df = pd.read_excel(input_excel)
    people = collect_people(df)

    # 1) Узлы-отправители
    senders = df['Отправитель'].dropna().unique()
    nodes_persons = []
    for i, s in enumerate(senders):
        pid = make_id(s)
        node = {
            'id': pid,
            'label': people[pid]['label'],
            'type': 'person',
        }
        if people[pid]['imgExists']:
            node['img'] = f"{pid}.jpg"
        else:
            node['img'] = f"yvolen.png"
        if i == 0:
            node['fixed'] = True
        nodes_persons.append(node)

    # 2) Категории
    categories = df['Категория'].dropna().unique()
    nodes_categories = []
    for c in categories:
        cid = translit(c).replace(' ', '_').lower()
        nodes_categories.append({
            'id': cid,
            'label': c,
            'type': 'category'
        })

    # 3) Теги
    tag_group = df.groupby(['Тег', 'Категория'], as_index=False)['Количество получателей'].sum()
    nodes_tags = []
    for _, row in tag_group.iterrows():
        tid = translit(row['Тег']).replace(' ', '_').lower()
        nodes_tags.append({
            'id': tid,
            'label': row['Тег'],
            'type': 'tag',
            'count': int(row['Количество получателей'])
        })

    # 4) Рёбра
    edges = []
    for _, row in df.iterrows():
        sid = make_id(row['Отправитель'])
        cid = translit(str(row['Категория'])).replace(' ', '_').lower()
        tid = translit(row['Тег']).replace(' ', '_').lower()

        edges.append({'source': sid, 'target': cid})  # sender → category
        edges.append({'source': cid, 'target': tid})  # category → tag

    graph = {'nodes': nodes_persons + nodes_categories + nodes_tags, 'edges': edges}
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
    print(f"-> {output_json} создан.")

if __name__ == '__main__':
    main()
