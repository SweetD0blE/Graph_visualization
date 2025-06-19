// script.js
const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("svg")
  .attr("width", width)
  .attr("height", height);

let container = svg.append("g");
let simulation;
let allNodes = [];
let allLinks = [];
let currentSenderKey = null;
let currentSenderLabel = null;
let expandLock = false;

const dateFilterEl = document.getElementById("dateFilter");

// Транслитерация
const translitMap = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
  "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
  "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ы": "y", "э": "e",
  "ю": "yu", "я": "ya"
};
function translit(s) {
  return s.toLowerCase().split("").map(ch => translitMap[ch] || ch).join("");
}

// --- ПАРСЕР НЕСТАНДАРТНЫХ ДАТ -------------------------
function parseRegDate(str) {
  if (!str) return NaN;

  // Формат YYYY-DD-MM HH:mm:ss
  const formats = [
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%d.%m.%Y %H:%M:%S",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d.%m.%Y",
  ];

  for (const format of formats) {
    const parsed = tryParseDate(str, format);
    if (!isNaN(parsed)) return parsed;
  }
  // ISO-формат
  const t = Date.parse(str);
  return isNaN(t) ? NaN : t;
}

function tryParseDate(str, format) {
  const tokens = {
    "%Y": "(\\d{4})", "%m": "(\\d{2})", "%d": "(\\d{2})",
    "%H": "(\\d{2})", "%M": "(\\d{2})", "%S": "(\\d{2})"
  };
  const regex = new RegExp("^" + format.replace(/%[YmdHMS]/g, m => tokens[m]) + "$");
  const match = str.match(regex);
  if (!match) return NaN;

  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

function filterByDate(edges, range) {
  if (range === "all") return edges;
  const now = Date.now();
  return edges.filter(e => {
    const t = parseRegDate(e.details.reg_date);
    if (isNaN(t)) return false;
    const delta = now - t;
    switch (range) {
      case '7d': return delta <= 7 * 24 * 60 * 60 * 1000;
      case '1m': return delta <= 30 * 24 * 60 * 60 * 1000;
      case '3m': return delta <= 90 * 24 * 60 * 60 * 1000;
      case '6m': return delta <= 180 * 24 * 60 * 60 * 1000;
      case '9m': return delta <= 270 * 24 * 60 * 60 * 1000;
      case '1y': return delta <= 365 * 24 * 60 * 60 * 1000;
      case '2y': return delta <= 730 * 24 * 60 * 60 * 1000;
      default: return true;
    }
  });
}

// --- Загрузка исходных данных -------------------------
let graphDataNodes = [];
d3.json("graph_data.json")
  .then(data => { graphDataNodes = data.nodes; })
  .catch(err => { console.error("Ошибка загрузки graph_data.json:", err); });

// --- ZOOM & PAN ---------------------------------------
const zoomBehavior = d3.zoom()
  .filter(event => {
    if (event.type === 'dblclick') return false;
    return (!event.button && event.type !== 'dblclick')
  })
  .scaleExtent([0.1, 5])
  .on("zoom", event => {
    container.attr("transform", event.transform);
  });
svg.call(zoomBehavior).on("dblclick.zoom", null);

// Добавим кнопки масштабирования в левый нижний угол
// Кнопки масштабирования
const zoomControls = d3.select("body")
  .append("div")
  .attr("id", "zoom-controls");

zoomControls.append("button")
  .attr("id", "zoom-in")
  .text("+")
  .on("click", () => {
    svg.transition().call(zoomBehavior.scaleBy, 1.2);
  });

zoomControls.append("button")
  .attr("id", "zoom-out")
  .text("−")
  .on("click", () => {
    svg.transition().call(zoomBehavior.scaleBy, 1 / 1.2);
  });


// --- DRAG HANDLERS ------------------------------------
function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}
function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}
function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  if (d.type ==="category" || d.type ==="tag" || d.fixed || d.expanded || d.type === "doc_type") {
    d.fx = d.x;
    d.fy = d.y;
  } else {
    d.fx = null;
    d.fy = null;
  }
}

// --- SHOW DETAILS -------------------------------------
function showEdgeDetails(d) {
  const det = d.details || {};
  d3.select("#detailsContent").html(`
    <p><strong>Ссылка:</strong> ${det.link || '-'}</p>
    <p><strong>Номер регистрации:</strong> ${det.registration_number || '-'}</p>
    <p><strong>Системный номер:</strong> ${det.system_number || '-'}</p>
    <p><strong>Дата регистрации:</strong> ${det.reg_date || '-'}</p>
    <p><strong>Дата обновления:</strong> ${det.update_date || '-'}</p>
    <p><strong>Содержание:</strong> ${det.content || '-'}</p>
    <p><strong>Отправитель:</strong> ${det.sender || '-'}</p>
    <p><strong>Получатели:</strong> ${Array.isArray(det.receivers)
      ? det.receivers.join(", ")
      : det.receivers || '-'}</p>
    <p><strong>Приватность:</strong> ${det.privacy || '-'}</p>
    <p><strong>Тип документа:</strong> ${det.doc_type || '-'}</p>
    <p><strong>Категория документа:</strong> ${det.doc_category || '-'}</p>
    <p><strong>Срочность:</strong> ${det.urgency || '-'}</p>
    <p><strong>Этап:</strong> ${det.stage || '-'}</p>
    <p><strong>Тег:</strong> ${det.tag || '-'}</p>
    <p><strong>Категория:</strong> ${det.category || '-'}</p>
  `);
  d3.select("#detailsContent").style("display", "block");
}

// --- ПОСТРОЕНИЕ ГРАФА ---------------------------------
function buildGraphFromSender(senderInput) {
  currentSenderLabel = senderInput;
  currentSenderKey = senderInput.trim().toLowerCase();

  const matched = [];

  Object.entries(window.extraData).forEach(([tagId, data]) => {
    data.edges.forEach(e => {
      if ((e.details.sender || "").toLowerCase() === currentSenderKey) {
        matched.push({ tagId, data, details: e.details });
      }
    });
  });

  const range = dateFilterEl.value;
  const filtered = matched.filter(({ details }) => filterByDate([{ details }], range).length);
  if (!filtered.length) return alert("Нет документов за период.");

  const senderId = "sender_node";
  const fam = senderInput.split(" ")[0];
  const senderIdGuess = translit(fam);
  const senderImg = graphDataNodes.find(n => n.id === senderIdGuess)?.img;

  const nodeMap = new Map();
  const links = [];
  const docTypeMap = {};

  nodeMap.set(senderId, {
    id: senderId,
    label: currentSenderLabel,
    type: "person",
    img: senderImg || null,
    fixed: true
  });

  filtered.forEach(({ tagId, details }) => {
    const category = details.category || "Без категории";
    const categoryId = translit(category).replace(/\s+/g, "_");

    const tag = details.tag || tagId;
    const tagIdNode = tagId;

    const docType = details.doc_type || "Без типа";
    const docId = `${tagIdNode}_doc_${translit(docType)}`;
    const regNum = details.registration_number || `unnamed_${Math.random()}`;

    // Категория
    if (!nodeMap.has(categoryId)) {
      nodeMap.set(categoryId, { id: categoryId, label: category, type: "category" });
      links.push({ source: senderId, target: categoryId });
    }

    // Тег
    if (!nodeMap.has(tagIdNode)) {
      nodeMap.set(tagIdNode, { id: tagIdNode, label: tag, type: "tag" });
      links.push({ source: categoryId, target: tagIdNode });
    }

    // Вид документа
    if (!nodeMap.has(docId)) {
      nodeMap.set(docId, {
        id: docId,
        label: docType,
        type: "doc_type",
        count: 0,
        docs: new Set()
      });
      links.push({ source: tagIdNode, target: docId });
    }

    nodeMap.get(docId).docs.add(regNum);

    // Подсчёт doc_type на уровне тега
    docTypeMap[tagIdNode] = docTypeMap[tagIdNode] || new Set();
    docTypeMap[tagIdNode].add(docType);
  });

  // Обновляем .count на doc_type
  for (const node of nodeMap.values()) {
    if (node.type === "doc_type") {
      node.count = node.docs.size;
      delete node.docs; // Удалим временное поле
    }
  }

  // Обновляем .count на тегах (кол-во doc_type)
  for (const [tagIdNode, docSet] of Object.entries(docTypeMap)) {
    const node = nodeMap.get(tagIdNode);
    if (node) node.count = docSet.size;
  }

  allNodes = Array.from(nodeMap.values());
  allLinks = links;
  buildGraph(allNodes, allLinks);
}

// --- ВИЗУАЛИЗАЦИЯ -------------------------------------
function buildGraph(nodes, links) {
  if (simulation) simulation.stop();

  nodes.forEach(n => {
    if (typeof n.x !== 'number') n.x = width / 2 + (Math.random() - 0.5) * 200;
    if (typeof n.y !== 'number') n.y = height / 2 + (Math.random() - 0.5) * 200;
  });
  const currentTransform = d3.zoomTransform(svg.node());
  d3.select("#detailsContent").style("display", "none").html("");
  svg.selectAll("g").remove();
  container = svg.append("g")
    .attr("transform", currentTransform);

  const linkGroup = container.append("g").attr("class", "links");
  const nodeGroup = container.append("g").attr("class", "nodes");

  // Цвета для doc_type > person
  const docKeys = Array.from(new Set(
    links
      .filter(d => {
        const src = d.source.id || d.source;
        const tgt = d.target.id || d.target;
        const srcType = (nodes.find(n => n.id === src) || {}).type;
        const tgtType = (nodes.find(n => n.id === tgt) || {}).type;
        return srcType === "doc_type" && tgtType === "person";
      })
      .map(l => l.details?.registration_number)
  ));

  const edgeColor = d3.scaleOrdinal()
    .domain(docKeys)
    .range(d3.schemeSet3);

  // Настройка симуляции с усиленным отталкиванием и большей дистанцией
  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(220).strength(1))
    .force("charge", d3.forceManyBody().strength(-700))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => getNodeRadius(d) + 10));

  // Линии
  linkGroup.selectAll("line")
    .data(links, d => `${d.source.id || d.source}->${d.target.id || d.target}`)
    .join("line")
    .attr("class", "link")
    .attr("stroke", d => {
      const srcId = d.source.id || d.source;
      const tgtId = d.target.id || d.target;
      const srcType = (nodes.find(n => n.id === srcId) || {}).type;
      const tgtType = (nodes.find(n => n.id === tgtId) || {}).type;

      return (srcType === "doc_type" && tgtType === "person")
        ? edgeColor(d.details?.registration_number || "default")
        : "#888";
    })
    .attr("stroke-width", 6)
    .on("click", (e, d) => showEdgeDetails(d));

  // Узлы
  const nodeSel = nodeGroup.selectAll("g.node")
    .data(nodes, d => d.id)
    .join(enter => {
      const g = enter.append("g")
        .attr("class", "node")
        .call(d3.drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended));

      g.each(function (d) {
        const r = getNodeRadius(d);
        const grp = d3.select(this);

        if (d.img) {
          grp.append("image")
            .attr("href", d.img)
            .attr("x", -r).attr("y", -r)
            .attr("width", 2 * r).attr("height", 2 * r)
            .attr("clip-path", `circle(${r}px at ${r}px ${r}px)`);
        } else {
          grp.append("circle")
            .attr("r", r)
            .attr("fill",
              d.type === "person" ? "#FF7043" :
              d.type === "category" ? "#42A5F5" :
              d.type === "tag" ? "#66BB6A" :
              "#AB47BC");
        }

        grp.append("text")
          .attr("dy", r + 14)
          .attr("text-anchor", "middle")
          .style("fill", "#fff")
          .style("font-size", "12px")
          .text(d.label);
      });

      return g;
    });

  // Счётчики на тегах (уникальные doc_type)
  nodeSel.filter(d => d.type === "tag" && d.count > 0)
    .append("circle")
    .attr("class", "count-bubble")
    .attr("r", 15)
    .attr("cx", 18)
    .attr("cy", -25)
    .attr("fill", "grey")
    .on("click", (e, d) => {
      e.stopPropagation();
      const edge = links.find(l => l.source === d.id || l.source.id === d.id);
      if (edge) showEdgeDetails(edge);
    });

  nodeSel.filter(d => d.type === "tag" && d.count > 0)
    .append("text")
    .attr("class", "count-text")
    .attr("x", 18)
    .attr("y", -21)
    .style("fill", "#fff")
    .style("font-size", "15px")
    .style("text-anchor", "middle")
    .text(d => d.count);

  // Один simulation.tick
  simulation.on("tick", () => {
    linkGroup.selectAll("line")
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    linkGroup.selectAll("text.link-label")
      .attr("x", d => (d.source.x + d.target.x) / 2)
      .attr("y", d => (d.source.y + d.target.y) / 2);

    nodeGroup.selectAll("g.node")
      .attr("transform", d => `translate(${d.x},${d.y})`);
  });

  // Функция радиуса
  function getNodeRadius(d) {
   if (d.type === "person" && d.fixed) return 60;
   if (d.type === "category") return 50;
   if (d.type === "tag") return 40;
   if (d.type === "doc_type") {
     const base = 30;
     const radius = base + (d.count > 1 ? (d.count - 1) * 5 : 0);
     return Math.min(radius, 180);  // Ограничение максимального радиуса
  } 
   return 30;
 }

  // double-click на doc_type > раскрытие получателей
 nodeSel.filter(d => d.type === "doc_type")
  .on("dblclick", (event, d) => {
    if (expandLock) return;
    expandLock = true;
	
	  // Зафиксируем doc_type, чтобы он не "улетал"
    const docNode = allNodes.find(n => n.id === d.id);
    if (docNode) {
      docNode.fx = docNode.x;
      docNode.fy = docNode.y;
    }

    const tagId = d.id.split("_doc_")[0];
    const extra = window.extraData[tagId];
    if (!extra || !currentSenderKey) return;

    let edgesFor = extra.edges.filter(e =>
      (e.details.sender || "").toLowerCase() === currentSenderKey &&
      (e.details.doc_type || "").toLowerCase() === d.label.toLowerCase()
    );
    edgesFor = filterByDate(edgesFor, dateFilterEl.value);
    if (!edgesFor.length) return;

    const recNames = Array.from(new Set(edgesFor.flatMap(e => e.details.receivers || [])));
    const R = 150, step = 2 * Math.PI / recNames.length;
    let idx = 0;

    const newNodes = recNames.map(name => {
      const isSenderItself = name.toLowerCase() === currentSenderKey;
      const orig = extra.nodes.find(n => n.label === name || n.id === name);
      const baseId = orig?.id || `recv_${idx}`;
      const nodeId = `${d.id}_${isSenderItself ? "self" : baseId}`;

      if (allNodes.some(n => n.id === nodeId)) return null;

      return {
        id: nodeId,
        label: name,
        type: "person",
        img: orig?.img || null,
        x: d.x + R * Math.cos(idx * step),
        y: d.y + R * Math.sin(idx * step)
      };
    }).filter(Boolean);

    const newEdges = [];

    newNodes.forEach(n => {
      const matchedDocs = edgesFor.filter(e =>
        (e.details.receivers || []).includes(n.label)
      );

    matchedDocs.forEach(e => {
    newEdges.push({ source: d.id, target: n.id, details: e.details });
  });
});

    allNodes.push(...newNodes);
    allLinks.push(...newEdges);

    simulation.nodes(allNodes)
      .force("link", d3.forceLink(allLinks)
        .id(n => n.id)
        .distance(220)
        .strength(1))
      .alpha(1)
      .restart();

    buildGraph(allNodes, allLinks);

    setTimeout(() => expandLock = false, 5000);
  });
}

// --- FILL SENDER SELECT --------------------------------
function populateSenderSelect() {
  const senderSet = new Set();

  Object.values(window.extraData).forEach(({ edges }) => {
    edges.forEach(e => {
      const sender = e.details?.sender?.trim();
      if (sender) senderSet.add(sender);
    });
  });

  const select = document.getElementById("sender-select");
  if (!select) return;

  const sortedSenders = Array.from(senderSet).sort((a, b) => a.localeCompare(b, 'ru'));

  // Очистка и заполнение
  for (const sender of sortedSenders) {
    const opt = document.createElement("option");
    opt.value = sender;
    opt.textContent = sender;
    select.appendChild(opt);
  }
}

// Вызовим populate при загрузке данных
d3.json("graph_data.json")
  .then(data => {
    graphDataNodes = data.nodes;
    populateSenderSelect();  // Заполнить select отправителей
  })
  .catch(err => { console.error("Ошибка загрузки graph_data.json:", err); });

// --- UI -----------------------------------------------
document.getElementById("searchButton").addEventListener("click", () => {
  const v = document.getElementById("sender-select").value.trim();
  if (v) buildGraphFromSender(v);
  else alert("Выберите отправителя из списка.");
});

document.getElementById("backButton").addEventListener("click", () => {
  document.getElementById("sender-select").value = "";
  d3.select("svg").selectAll("*").remove();
  d3.select("#detailsContent").style("display", "none");
  allNodes = [];
  allLinks = [];
  currentSenderKey = null;
  currentSenderLabel = null;
});

dateFilterEl.addEventListener("change", () => {
  if (currentSenderKey) buildGraphFromSender(currentSenderLabel);
});

// --- HELP MODAL ---------------------------------------
const helpModal = document.getElementById("helpModal");
const helpButton = document.getElementById("helpButton");
const closeModal = document.querySelector(".modal .close");

helpButton.onclick = () => {
  helpModal.style.display = "block";
};

closeModal.onclick = () => {
  helpModal.style.display = "none";
};

window.onclick = event => {
  if (event.target === helpModal) {
    helpModal.style.display = "none";
  }
};