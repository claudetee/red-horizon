# RED HORIZON — tooling

零依赖工具链（Node ≥ 21 / Python 3 标准库）。

## genimg.mjs — gpt-image 资产生成
```bash
export OPENROUTER_API_KEY=sk-or-...
node genimg.mjs --batch asset_spec.json               # 按清单批量生成（跳过已存在）
node genimg.mjs --batch asset_spec.json --only unit_tank_hull --force
node genimg.mjs --prompt "..." --out x.png --model openai/gpt-image-1 --background transparent
```

## png_tool.py — 纯 Python PNG 后处理
```bash
python3 png_tool.py batch                              # raw/ -> img/ 全量处理 + sprites.json
python3 png_tool.py batch --only prop_tree1,ter_dirt
python3 png_tool.py info ../assets/img/unit_rifle.png
```
管线：解码 → (色键) → 透明裁切 → alpha 加权盒式缩放 → alpha 硬化 → 中位切分量化(可 FS 抖动) → 1px 描边 → 编码。

## browse.mjs — CDP 浏览器驱动（E2E）
Node 内置 WebSocket 直连 playwright chromium headless shell，无需安装任何包。
```bash
node browse.mjs steps.json
```
步骤 DSL：`goto / wait / waitFor(js) / click[x,y] / rclick / dblclick / drag / clickWorld[wx,wy] /
rclickWorld / dragWorld / move / key(F2|KeyA|Escape) / keys(Ctrl+Digit1) / eval / evalLog / shot(path)`。
自动收集 console 与 JS 异常。`?debug` 模式热键：F2 资金 F3 全图 F4 快建 F5 波次 F6 胜 F7 负。
