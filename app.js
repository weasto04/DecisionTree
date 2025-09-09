/* globals DATA */
// Minimal front-end-only decision tree traversal + SVG animation.

const svgNS = 'http://www.w3.org/2000/svg';

function createEl(type, attrs = {}, text) {
  const el = document.createElementNS(svgNS, type);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = String(text);
  return el;
}

function layoutTree(nodes) {
  // Compute a simple layered layout: depth by BFS, x by order within depth.
  const children = new Map();
  const parents = new Map();
  nodes.forEach(n => {
    children.set(n.id, []);
  });
  nodes.forEach(n => {
    if (n.left != null) { children.get(n.id).push(n.left); parents.set(n.left, n.id); }
    if (n.right != null) { children.get(n.id).push(n.right); parents.set(n.right, n.id); }
  });
  // root is node without parent
  const root = nodes.find(n => !parents.has(n.id)) || nodes[0];
  const levels = [];
  const q = [{ id: root.id, depth: 0 }];
  const seen = new Set();
  while (q.length) {
    const { id, depth } = q.shift();
    if (seen.has(id)) continue; seen.add(id);
    const node = nodes[id];
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node.id);
    for (const ch of children.get(id)) q.push({ id: ch, depth: depth + 1 });
  }
  const depthCount = levels.length;
  const width = 1100, height = 620, marginX = 40, marginY = 40;
  const layerH = (height - marginY * 2) / Math.max(1, depthCount - 1);

  const positions = new Map();
  for (let d = 0; d < levels.length; d++) {
    const ids = levels[d];
    const gap = (width - marginX * 2) / (ids.length + 1);
    for (let i = 0; i < ids.length; i++) {
      const x = marginX + gap * (i + 1);
      const y = marginY + d * layerH;
      positions.set(ids[i], { x, y });
    }
  }
  return { positions, rootId: root.id };
}

function drawTree(svg, nodes, positions, featureNames, targetNames) {
  svg.innerHTML = '';
  const edgesGroup = createEl('g', { class: 'edges' });
  const nodesGroup = createEl('g', { class: 'nodes' });
  svg.appendChild(edgesGroup);
  svg.appendChild(nodesGroup);

  // Draw edges first
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (n.left != null) {
      const c = positions.get(n.left);
      const path = createEl('path', {
        class: 'edge',
        id: `edge-${n.id}-${n.left}`,
        d: `M${p.x},${p.y+20} L${c.x},${c.y-20}`,
      });
      edgesGroup.appendChild(path);
    }
    if (n.right != null) {
      const c = positions.get(n.right);
      const path = createEl('path', {
        class: 'edge',
        id: `edge-${n.id}-${n.right}`,
        d: `M${p.x},${p.y+20} L${c.x},${c.y-20}`,
      });
      edgesGroup.appendChild(path);
    }
  }

  // Draw nodes
  for (const n of nodes) {
    const { x, y } = positions.get(n.id);
    const g = createEl('g', { class: `node ${n.is_leaf ? 'leaf' : ''}`, id: `node-${n.id}` });
    // smaller node box to reduce overlap
    const w = 130, h = 46;
    const rect = createEl('rect', { x: x - w/2, y: y - h/2, width: w, height: h, rx: 8, ry: 8 });
    g.appendChild(rect);
    const label = n.is_leaf
      ? `leaf → ${predToText(n.value, targetNames)}`
      : `${featureNames[n.feature]} ≤ ${n.threshold.toFixed(3)}`;
    // shift label a little higher for smaller box
    const labelText = createEl('text', { x, y: y - 6, class: 'label', 'text-anchor': 'middle' }, label);
    g.appendChild(labelText);

    const rule = n.is_leaf ? countsToText(n.value, targetNames) : `true → left, false → right`;
    const ruleText = createEl('text', { x, y: y + 12, class: 'rule', 'text-anchor': 'middle' }, rule);
    g.appendChild(ruleText);

    // If leaf, color the rectangle subtly by dominant predicted class
    if (n.is_leaf && n.value && Array.isArray(n.value)) {
      const maxIdx = n.value.reduce((mi, v, i) => v > n.value[mi] ? i : mi, 0);
      rect.setAttribute('fill', colorForClass(maxIdx));
      rect.setAttribute('fill-opacity', '0.12');
    }

    nodesGroup.appendChild(g);
  }
}

function countsToText(value, targetNames) {
  return value
    .map((c, i) => `${targetNames[i]}:${c}`)
    .join('  ');
}

function predToText(value, targetNames) {
  let maxIdx = 0; let maxV = -Infinity;
  value.forEach((v, i) => { if (v > maxV) { maxV = v; maxIdx = i; } });
  return targetNames[maxIdx] ?? String(maxIdx);
}

function traverse(nodes, sample) {
  // Return path of node ids from root to leaf based on feature thresholds.
  let id = 0; // sklearn root is id 0
  const path = [0];
  while (true) {
    const n = nodes[id];
    if (n.is_leaf) break;
    const f = n.feature; const thr = n.threshold;
    const goLeft = sample[f] <= thr;
    id = goLeft ? n.left : n.right;
    path.push(id);
  }
  return path;
}

function colorForClass(idx) {
  const palette = ['#e11d48', '#06b6d4', '#84cc16', '#f59e0b', '#7c3aed'];
  return palette[idx % palette.length];
}

function buildLegend(container, targetNames) {
  container.innerHTML = '<h3>Classes</h3>';
  for (let i = 0; i < targetNames.length; i++) {
    const row = document.createElement('div'); row.className = 'row';
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = colorForClass(i);
    const text = document.createElement('span'); text.textContent = targetNames[i];
    row.appendChild(sw); row.appendChild(text);
    container.appendChild(row);
  }
}

function animateTraversal(svg, nodes, positions, samples, labels, classNames, speed = 1) {
  // Animate samples sequentially and leave persistent markers at their final node.
  const svgNS = 'http://www.w3.org/2000/svg';
  let playing = false;
  let stopRequested = false;

  // create or get marker layer
  let markerLayer = svg.querySelector('#marker-layer');
  if (!markerLayer) {
    markerLayer = document.createElementNS(svgNS, 'g');
    markerLayer.setAttribute('id', 'marker-layer');
    svg.appendChild(markerLayer);
  }

  function placeMarker(nodeId, classIdx) {
    const pos = positions.get(nodeId);
    // compute offset to avoid exact overlap (count existing markers at node)
    const existing = Array.from(markerLayer.children).filter(m => Math.abs(Number(m.getAttribute('data-node')) - nodeId) < 0.5);
    const offset = existing.length * 12 - (existing.length * 6);
    const cx = pos.x + offset;
    const cy = pos.y + 34;
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', 6);
    c.setAttribute('fill', colorForClass(classIdx));
    c.setAttribute('class', 'node-marker');
    c.setAttribute('data-node', nodeId);
  markerLayer.appendChild(c);
  }

  async function animateSample(sampleIdx) {
    const sample = samples[sampleIdx];
    const trueLabel = labels[sampleIdx];
    const path = traverse(nodes, sample);

    // create moving ball
    const ball = document.createElementNS(svgNS, 'circle');
    ball.setAttribute('r', 7);
    ball.setAttribute('class', 'ball');
    ball.setAttribute('fill', colorForClass(trueLabel));
    svg.appendChild(ball);

    for (let i = 0; i < path.length; i++) {
      if (stopRequested) break;
      const fromId = path[i];
      const pos = positions.get(fromId);
      // move the ball to this position
      ball.setAttribute('cx', pos.x);
      ball.setAttribute('cy', pos.y - 30);
      // highlight outgoing edge to next node
      if (i < path.length - 1) {
        const toId = path[i+1];
        const edge = svg.querySelector(`#edge-${fromId}-${toId}`);
        if (edge) edge.classList.add('active');
      }
      await new Promise(r => setTimeout(r, 350 / speed));
      // clear edges leaving this node (we keep last edge highlighted briefly)
      svg.querySelectorAll('.edge.active').forEach(e => e.classList.remove('active'));
    }

    // finished - place persistent marker at final node
    if (!stopRequested) {
      const finalNode = path[path.length - 1];
      placeMarker(finalNode, trueLabel);
    }
    ball.remove();
  }

  return {
    playAll: async function() {
      if (playing) return;
      playing = true; stopRequested = false;
      for (let i = 0; i < samples.length; i++) {
        if (stopRequested) break;
        // animate each sample sequentially
        // eslint-disable-next-line no-await-in-loop
        await animateSample(i);
      }
      playing = false; stopRequested = false;
    },
    stop() { stopRequested = true; playing = false; },
    clearMarkers() { markerLayer.innerHTML = ''; },
    setSpeed(v) { speed = v; }
  };
}

function bootstrap() {
  const svg = document.getElementById('tree');
  const legend = document.getElementById('legend');
  const btnPlay = document.getElementById('btn-play');
  const btnStop = document.getElementById('btn-stop');
  const statusEl = document.getElementById('status');

  // Handle missing data.js gracefully
  if (typeof window.DATA === 'undefined') {
    statusEl.textContent = 'Error: data.js failed to load';
    console.error('data.js not found. Make sure you are serving the folder and data.js exists next to index.html');
    return;
  }

  const { meta, tree, test } = window.DATA;
  buildLegend(legend, meta.targetNames);
  const layout = layoutTree(tree.nodes);
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    statusEl.textContent = 'Error: tree has no nodes';
    console.error('Tree data invalid:', tree);
    return;
  }
  drawTree(svg, tree.nodes, layout.positions, meta.featureNames, meta.targetNames);

  const controller = animateTraversal(svg, tree.nodes, layout.positions, test.X, test.y, meta.targetNames, 1);

  function updateStatus() {
    statusEl.textContent = 'samples: ' + test.X.length + ' | depth≤4';
  }
  updateStatus();

  if (btnPlay) btnPlay.addEventListener('click', () => controller.playAll());
  if (btnStop) btnStop.addEventListener('click', () => controller.stop());
}

window.addEventListener('DOMContentLoaded', bootstrap);
