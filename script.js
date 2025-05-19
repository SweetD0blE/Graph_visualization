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
let tagClickEnabled = true;

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

// Загрузка graph_data.json
let graphDataNodes = [];
d3.json("graph_data.json")
  .then(data => { graphDataNodes = data.nodes; })
  .catch(err => { console.error("Ошибка загрузки graph_data.json:", err); });

// ─── ZOOM & PAN ───────────────────────────────────────
const zoomBehavior = d3.zoom()
  .filter(event => {
    if (event.type === 'dblclick') return false;
    return (!event.button && event.type !== 'dblclick')
  })
  .scaleExtent([0.5, 5])
  .on("zoom", event => {
    container.attr("transform", event.transform);
  });
svg.call(zoomBehavior).on("dblclick.zoom", null);

// ─── DRAG HANDLERS ────────────────────────────────────
function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d) {
  d.fx = event.x; d.fy = event.y;
}
function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  if (d.type === "category" || d.expanded) {
    d.fx = d.x;
    d.fy = d.y;
  } else {
    d.fx = null;
    d.fy = null;
  }
}

// ─── SHOW DETAILS ─────────────────────────────────────
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

// ─── BUILD GRAPH FROM SENDER ─────────────────────────
function buildGraphFromSender(senderInput) {
  currentSenderLabel = senderInput;
  currentSenderKey = senderInput.trim().toLowerCase();

  const matched = [];

  // Собираем все связи, где отправитель совпадает
  Object.entries(window.extraData).forEach(([tagId, data]) => {
    data.edges.forEach(e => {
      const sender = (e.details.sender || "").toLowerCase();
      if (sender === currentSenderKey) {
        matched.push({ tagId, data, details: e.details });
      }
    });
  });

  if (!matched.length) {
    alert("Отправитель не найден.");
    return;
  }

  // Фильтруем по дате
  const range = dateFilterEl.value;
  const filtered = matched.filter(({ details }) => filterByDate([{ details }], range).length);

  if (!filtered.length) {
    alert("Нет документов за выбранный период.");
    return;
  }

  // Инициализация
  const nodesMap = new Map();
  const links = [];
  const senderId = "sender_node";

  const fam = senderInput.split(" ")[0];
  const senderIdGuess = translit(fam);
  const senderNodeInfo = graphDataNodes.find(n => n.id === senderIdGuess);

  nodesMap.set(senderId, {
    id: senderId,
    label: currentSenderLabel,
    type: "person",
    img: senderNodeInfo ? senderNodeInfo.img : null,
    fixed: true
  });

  // Построение структуры: sender → category → tag
  filtered.forEach(({ tagId, details }) => {
    const tagLabel = details.tag || tagId;
    const categoryLabel = details.category || "Без категории";

    const categoryId = translit(categoryLabel).replace(/\s+/g, "_");
    const tagNodeId = tagId;

    // Категория
    if (!nodesMap.has(categoryId)) {
      nodesMap.set(categoryId, {
        id: categoryId,
        label: categoryLabel,
        type: "category"
      });
      links.push({ source: senderId, target: categoryId });
    }

    // Тег
    if (!nodesMap.has(tagNodeId)) {
      nodesMap.set(tagNodeId, {
        id: tagNodeId,
        label: tagLabel,
        type: "tag"
      });
    }

    links.push({ source: categoryId, target: tagNodeId });
  });

  // Счётчики тегов
  const tagCounts = {};
  filtered.forEach(({ tagId }) => {
    tagCounts[tagId] = (tagCounts[tagId] || 0) + 1;
  });

  // Применяем счётчики к тегам
  for (const [id, node] of nodesMap.entries()) {
    if (node.type === "tag") node.count = tagCounts[id] || 0;
  }

  allNodes = Array.from(nodesMap.values());
  allLinks = links;

  buildGraph(allNodes, allLinks);
}

// ─── BUILD GRAPH ──────────────────────────────────────
function buildGraph(nodes, links) {
  const currentTransform = d3.zoomTransform(svg.node());
  d3.select("#detailsContent").style("display", "none").html("");
  svg.selectAll("g").remove();
  container = svg.append("g")
    .attr("transform", currentTransform);

  const linkGroup = container.append("g").attr("class", "links");
  const nodeGroup = container.append("g").attr("class", "nodes");

  const docKeys = Array.from(new Set(links.map(l => l.details?.registration_number)));
  const edgeColor = d3.scaleOrdinal()
    .domain(docKeys)
    .range(d3.schemeSet3);

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id(d => d.id)
      .distance(180)
      .strength(1))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => 45));

  // Линии
  linkGroup.selectAll("line")
    .data(links, d => `${d.source.id || d.source}->${d.target.id || d.target}`)
    .join("line")
    .attr("class", "link")
    .attr("stroke", d => {
      const srcType = d.source.type || nodes.find(n => n.id === d.source)?.type;
      return srcType === "tag"
        ? edgeColor(d.details?.registration_number)
        : "#888";
    })
    .attr("stroke-width", 2)
    .on("click", (e, d) => showEdgeDetails(d));

  // Подписи "1"
  linkGroup.selectAll("text.link-label")
    .data(
      links.filter(d => {
        const src = d.source.id || d.source;
        const nd = nodes.find(n => n.id === src);
        return nd && nd.type === "tag";
      }),
      d => `${d.source.id || d.source}->${d.target.id || d.target}`
    )
    .join("text")
    .attr("class", "link-label")
    .attr("dy", -5)
    .attr("text-anchor", "middle")
    .attr("font-size", "16px")
    .attr("fill", "#fff")
    .text("1")
    .on("click", (e, d) => showEdgeDetails(d));

  // Узлы
  const nodeSel = nodeGroup.selectAll("g.node")
    .data(nodes, d => d.id)
    .join(
      enter => {
        const g = enter.append("g")
          .attr("class", "node")
          .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

        const r = d => d.type === "person" && d.fixed ? 40 : d.type === "category" ? 35 : 30;

        g.each(function (d) {
          const grp = d3.select(this);
          if (d.img) {
            grp.append("image")
              .attr("href", d.img)
              .attr("x", -r(d)).attr("y", -r(d))
              .attr("width", 2 * r(d)).attr("height", 2 * r(d))
              .attr("clip-path", `circle(${r(d)}px at ${r(d)}px ${r(d)}px)`);
          } else {
            grp.append("circle")
              .attr("r", r(d))
              .attr("fill",
                d.type === "person" && d.fixed ? "#FF7043" :
                  d.type === "category" ? "#42A5F5" :
                    d.type === "tag" ? "#66BB6A" : "#999");
          }
        });

        g.append("text")
          .attr("dy", d => r(d) + 14)
          .attr("text-anchor", "middle")
          .style("fill", "#fff")
          .style("font-size", "12px")
          .text(d => d.label);
        return g;
      },
      update => update,
      exit => exit.remove()
    );

  // Пузырьки-счётчики на тегах
  nodeSel.filter(d => d.type === "tag" && d.count > 0)
    .append("circle")
    .attr("class", "count-bubble")
    .attr("r", 10)
    .attr("cx", 18)
    .attr("cy", -25)
    .attr("fill", "grey")
    .on("click", (e, d) => {
      const edge = allLinks.find(l => (l.source.id || l.source) === d.id);
      if (edge) showEdgeDetails(edge);
      e.stopPropagation();
    });

  nodeSel.filter(d => d.type === "tag" && d.count > 0)
    .append("text")
    .attr("class", "count-text")
    .attr("x", 18)
    .attr("y", -21)
    .style("fill", "#fff")
    .style("font-size", "10px")
    .style("text-anchor", "middle")
    .text(d => d.count);

  // Обработка double-click по тегу
  nodeSel.filter(d => d.type === "tag")
    .on("dblclick", (event, d) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!tagClickEnabled) return;
      tagClickEnabled = false;
      const extra = window.extraData[d.id];
      if (!extra || !currentSenderKey) return;

      let edgesFor = extra.edges.filter(e =>
        (e.details.sender || "").toLowerCase() === currentSenderKey
      );
      edgesFor = filterByDate(edgesFor, dateFilterEl.value);
      if (!edgesFor.length) return;

      const recNames = Array.from(new Set(edgesFor.flatMap(e => e.details.receivers || [])));
      const R = 150, step = 2 * Math.PI / recNames.length;
      let idx = 0;

      const newNodes = recNames.map(name => {
        const orig = extra.nodes.find(n => n.label === name || n.id === name);
        const clone = orig
          ? { ...orig }
          : { id: `${d.id}_recv_${idx}`, label: name, type: "person", img: null };
        clone.id = orig ? `${d.id}_${orig.id}` : clone.id;
        clone.x = d.x + R * Math.cos(idx * step);
        clone.y = d.y + R * Math.sin(idx * step);
        idx++;
        return clone;
      }).filter(n => !allNodes.some(x => x.id === n.id));

      const newEdges = newNodes.map(n => {
        const det = edgesFor.find(e =>
          (e.details.receivers || []).includes(n.label)
        ).details;
        return { source: d.id, target: n.id, details: det };
      });

      allNodes.push(...newNodes);
      allLinks.push(...newEdges);

      simulation.nodes(allNodes)
        .force("link", d3.forceLink(allLinks)
          .id(n => n.id)
          .distance(180)
          .strength(1))
        .alpha(1)
        .restart();

      simulation.on("end", () => {
        tagClickEnabled = true;
        simulation.on("end", null);
      });

      buildGraph(allNodes, allLinks);
    });

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
}

// ─── UI EVENTS ───────────────────────────────────────
document.getElementById("searchButton").addEventListener("click", () => {
  const v = document.getElementById("searchInput").value.trim();
  if (v) buildGraphFromSender(v);
  else alert("Введите фамилию отправителя");
});

document.getElementById("backButton").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  d3.select("svg").selectAll("*").remove();
  d3.select("#detailsContent").style("display", "none");
  allNodes = [];
  allLinks = [];
  currentSenderKey = null;
  currentSenderLabel = null;
});

// перестроить при смене периода
dateFilterEl.addEventListener("change", () => {
  if (currentSenderKey) buildGraphFromSender(currentSenderLabel);
});
