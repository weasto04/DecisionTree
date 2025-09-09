Wine Decision Tree Visualizer (front-end only)
=============================================

This is a tiny, framework-free web app that visualizes a trained DecisionTree on the sklearn Wine dataset and animates test samples traversing the tree.

What's included
- Static HTML/CSS/JS at the repo root
- A Python script that generates `data.js` with a trained tree and the train/test splits

Run locally
1) Generate the data (already committed in most cases):
	- Optional: run the exporter to regenerate `data.js` using your local scikit-learn.
2) Serve the repository root via any static server, for example Python's http.server.

Try it
```bash
python3 tools/export_data.py
python3 -m http.server 8080 --directory .
```
Then open http://localhost:8080/index.html and click Play, Pause, or Step to animate samples.

Notes
- No frameworks—just plain HTML/CSS/JS + an SVG drawing.
- The tree is kept shallow (max_depth=4) for readability.
- Colors indicate the ground-truth class of each animated sample.
# DecisionTree