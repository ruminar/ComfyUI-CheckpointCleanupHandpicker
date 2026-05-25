import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "ruminar.checkpoint_cleanup_handpicker";
const EVENT_NAME = "ruminar.checkpoint_cleanup_review";
const REVIEW_CLASS = "CheckpointCleanupReview";
const SELECTOR_CLASS = "CheckpointListSelector";
const TAGGER_CLASS = "CheckpointStatusTagger";
const TAGGER_EVENT_NAME = "ruminar.checkpoint_status_tagger";

const MIN_NODE_WIDTH = 420;
const MIN_NODE_HEIGHT = 440;
const PREVIEW_MARGIN = 8;
const PREVIEW_MAX_HEIGHT = 1600;
const CAPTION_HEIGHT = 22;
const BUTTON_BAR_HEIGHT = 28;
const BUTTON_GAP = 6;
const TOP_CONTROL_X = 150;
const TOP_CONTROL_Y = 10;
const TOP_PROGRESS_Y = TOP_CONTROL_Y + BUTTON_BAR_HEIGHT + 16;
const TOP_RESERVED_HEIGHT = 78;

function ensureNodeSize(node) {
    if (!node.size) return;
    node.size[0] = Math.max(node.size[0], MIN_NODE_WIDTH);
    node.size[1] = Math.max(node.size[1], MIN_NODE_HEIGHT);
}

function getInputValue(node, name) {
    const widget = node.widgets?.find((w) => w.name === name);
    return widget?.value ?? "";
}

function currentPayload(node) {
    return {
        ckpt_name_str: node.__ccrState?.ckpt_name_str ?? getInputValue(node, "ckpt_name_str"),
        ckpt_name_safe: node.__ccrState?.ckpt_name_safe ?? getInputValue(node, "ckpt_name_safe"),
        search_directory: node.__ccrState?.search_directory ?? getInputValue(node, "search_directory"),
    };
}

async function postAction(node, action) {
    try {
        const response = await api.fetchApi(`/checkpoint_cleanup_handpicker/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentPayload(node)),
        });
        const result = await response.json();

        node.__ccrMessage = result.ok ? "OK" : (result.error || "Action failed.");
        node.__ccrState = { ...(node.__ccrState ?? {}), ...result };

        if (result.title) {
            node.title = result.title;
        }

        app.graph.setDirtyCanvas(true, true);
    } catch (error) {
        node.__ccrMessage = String(error);
        app.graph.setDirtyCanvas(true, true);
    }
}

function buttonDefs(node) {
    const s = node.__ccrState ?? {};
    return [
        { label: "💛 お気に入り", action: "favorite", enabled: !!s.can_favorite },
        { label: "解除", action: "unfavorite", enabled: !!s.can_unfavorite },
        { label: "🗑 削除予約", action: "reserve_delete", enabled: !!s.can_reserve_delete },
        { label: "予約取消", action: "cancel_delete", enabled: !!s.can_cancel_delete },
    ];
}

function buttonRects(node) {
    const defs = buttonDefs(node);
    const x = Math.min(TOP_CONTROL_X, Math.max(PREVIEW_MARGIN, node.size[0] * 0.38));
    const y = TOP_CONTROL_Y;
    const w = Math.max(1, node.size[0] - x - PREVIEW_MARGIN);
    const h = BUTTON_BAR_HEIGHT;
    const each = Math.max(64, (w - BUTTON_GAP * (defs.length - 1)) / defs.length);

    return defs.map((def, idx) => ({
        ...def,
        x: x + idx * (each + BUTTON_GAP),
        y,
        w: each,
        h,
    }));
}

function drawButtons(node, ctx) {
    const rects = buttonRects(node);
    ctx.save();

    for (const r of rects) {
        ctx.fillStyle = r.enabled ? "rgba(80, 120, 180, 0.65)" : "rgba(80, 80, 80, 0.35)";
        ctx.strokeStyle = r.enabled ? "rgba(180, 220, 255, 0.75)" : "rgba(160, 160, 160, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();

        if (ctx.roundRect) {
            ctx.roundRect(r.x, r.y, r.w, r.h, 6);
        } else {
            ctx.rect(r.x, r.y, r.w, r.h);
        }

        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = r.enabled ? "#FFFFFF" : "#999999";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2);
    }

    ctx.restore();
}

function hitButton(node, pos) {
    for (const r of buttonRects(node)) {
        if (
            pos[0] >= r.x &&
            pos[0] <= r.x + r.w &&
            pos[1] >= r.y &&
            pos[1] <= r.y + r.h
        ) {
            return r;
        }
    }
    return null;
}

function drawPreview(node, ctx) {
    if (node.flags?.collapsed) return;

    const img = node.__ccrPreviewImage;
    const state = node.__ccrState;

    const availableWidth = Math.max(1, node.size[0] - PREVIEW_MARGIN * 2);
    const previewTop = TOP_RESERVED_HEIGHT + PREVIEW_MARGIN;
    const availableHeight = Math.max(1, node.size[1] - previewTop - PREVIEW_MARGIN);

    ctx.save();

    drawButtons(node, ctx);

    const progressX = Math.min(TOP_CONTROL_X, Math.max(PREVIEW_MARGIN, node.size[0] * 0.38));
    const progressW = Math.max(1, node.size[0] - progressX - PREVIEW_MARGIN);

    if (state?.status || node.__ccrMessage) {
        const isWarning = state?.status && !["ready", "favorite", "reserved", "loading"].includes(state.status);
        const msg = node.__ccrMessage || state?.progress_message || `${state?.status ?? ""}: ${state?.ckpt_name_str ?? ""}`;
        ctx.fillStyle = isWarning ? "rgba(255, 180, 80, 0.18)" : "rgba(0, 0, 0, 0.16)";
        ctx.fillRect(progressX, TOP_PROGRESS_Y - 13, progressW, 18);
        ctx.fillStyle = isWarning ? "#FFD28A" : "#DDDDDD";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(msg, progressX + 6, TOP_PROGRESS_Y);
    }

    if (img) {
        let drawWidth = availableWidth;
        let drawHeight = drawWidth * (img.height / img.width);

        if (drawHeight > availableHeight) {
            drawHeight = availableHeight;
            drawWidth = drawHeight * (img.width / img.height);
        }

        if (drawHeight > PREVIEW_MAX_HEIGHT) {
            drawHeight = PREVIEW_MAX_HEIGHT;
            drawWidth = drawHeight * (img.width / img.height);
        }

        if (drawWidth > availableWidth) {
            drawWidth = availableWidth;
            drawHeight = drawWidth * (img.height / img.width);
        }

        const x = PREVIEW_MARGIN + (availableWidth - drawWidth) / 2;
        const y = previewTop + Math.max(0, (availableHeight - drawHeight) / 2);

        ctx.fillStyle = "rgba(0, 0, 0, 0.20)";
        ctx.fillRect(
            PREVIEW_MARGIN,
            y - CAPTION_HEIGHT,
            availableWidth,
            drawHeight + CAPTION_HEIGHT
        );

        if (state) {
            ctx.fillStyle = "#DDDDDD";
            ctx.font = "12px sans-serif";
            const label = `${state.preview_count ?? 0} img · ${state.columns ?? 0}×${state.rows ?? 0} · sheet ${state.width ?? 0}×${state.height ?? 0}`;
            ctx.fillText(label, PREVIEW_MARGIN + 6, y - 5);
        }

        ctx.drawImage(img, x, y, drawWidth, drawHeight);
    }

    ctx.restore();
}

api.addEventListener(EVENT_NAME, ({ detail }) => {
    const nodeId = Number(detail.node);
    if (!Number.isFinite(nodeId)) return;

    const node = app.graph?.getNodeById(nodeId);
    if (!node) return;

    node.__ccrState = { ...(node.__ccrState ?? {}), ...detail };

    if (detail.title) {
        node.title = detail.title;
    }

    if (!detail.image) {
        if (detail.status !== "loading") {
            node.__ccrPreviewImage = null;
        }
        ensureNodeSize(node);
        app.graph.setDirtyCanvas(true, true);
        return;
    }

    const img = new Image();
    img.onload = () => {
        node.__ccrPreviewImage = img;
        node.__ccrMessage = null;
        ensureNodeSize(node);
        app.graph.setDirtyCanvas(true, true);
    };
    img.src = `data:image/${detail.format};base64,${detail.image}`;
});

api.addEventListener(TAGGER_EVENT_NAME, ({ detail }) => {
    const nodeId = Number(detail.node);
    if (!Number.isFinite(nodeId)) return;

    const node = app.graph?.getNodeById(nodeId);
    if (!node) return;

    node.__cctState = { ...(node.__cctState ?? {}), ...detail };
    node.__cctMessage = detail.message || null;
    if (detail.title) {
        node.title = detail.title;
    }
    app.graph.setDirtyCanvas(true, true);
});


const SELECTOR_MIN_WIDTH = 560;
const SELECTOR_MIN_HEIGHT = 510;
const SELECTOR_MARGIN = 8;
const SELECTOR_TOP_Y = 10;
const SELECTOR_ROW_HEIGHT = 20;
const SELECTOR_VISIBLE_ROWS = 20;
const SELECTOR_BUTTON_W1 = 126;
const SELECTOR_BUTTON_W2 = 92;
const SELECTOR_BUTTON_W3 = 34;
const SELECTOR_BUTTON_H = 24;
const SELECTOR_BUTTON_GAP = 6;

function checkpointWidget(node) {
    return node.widgets?.find((w) => w.name === "checkpoint");
}

function hideCheckpointWidget(node) {
    const w = checkpointWidget(node);
    if (!w) return;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
}

function ensureSelectorSize(node) {
    if (!node.size) return;
    node.size[0] = Math.max(node.size[0], SELECTOR_MIN_WIDTH);
    node.size[1] = Math.max(node.size[1], SELECTOR_MIN_HEIGHT);
}

function selectorListRect(node) {
    const x = SELECTOR_MARGIN;
    const y = 88;
    const w = Math.max(1, node.size[0] - SELECTOR_MARGIN * 2);
    const h = SELECTOR_ROW_HEIGHT * SELECTOR_VISIBLE_ROWS;
    return { x, y, w, h };
}

function selectorButtonRects(node) {
    const y = SELECTOR_TOP_Y;
    return {
        refreshAll: { x: SELECTOR_MARGIN, y, w: SELECTOR_BUTTON_W1 , h: SELECTOR_BUTTON_H },
        refreshList: { x: SELECTOR_MARGIN + SELECTOR_BUTTON_W1  + SELECTOR_BUTTON_GAP, y, w: SELECTOR_BUTTON_W2, h: SELECTOR_BUTTON_H },
        up: { x: SELECTOR_MARGIN + SELECTOR_BUTTON_W1 + SELECTOR_BUTTON_W2 + SELECTOR_BUTTON_GAP*2, y, w: 34, h: SELECTOR_BUTTON_H },
        down: { x: SELECTOR_MARGIN + SELECTOR_BUTTON_W1 + SELECTOR_BUTTON_W2 + SELECTOR_BUTTON_W3 + SELECTOR_BUTTON_GAP*3, y, w: 34, h: SELECTOR_BUTTON_H },
    };
}

function selectorSelected(node) {
    return checkpointWidget(node)?.value ?? "";
}

function setSelectorSelected(node, value) {
    const widget = checkpointWidget(node);
    if (widget) {
        widget.value = value;
    }
    node.__clsSelected = value;
    node.title = value ? `Checkpoint List Selector: ${value}` : "Checkpoint List Selector";
    app.graph.setDirtyCanvas(true, true);
}

async function refreshSelectorList(node) {
    try {
        node.__clsLoading = true;
        app.graph.setDirtyCanvas(true, true);

        const selected = encodeURIComponent(selectorSelected(node));
        const response = await api.fetchApi(`/checkpoint_cleanup_handpicker/list_checkpoints?selected=${selected}`);
        const result = await response.json();

        if (!result.ok) {
            node.__clsError = result.error || "Failed to list checkpoints.";
            return;
        }

        node.__clsItems = result.items ?? [];
        node.__clsError = null;

        const selectedValue = result.selected || node.__clsItems[0]?.ckpt_name_str || "";
        setSelectorSelected(node, selectedValue);

        const idx = node.__clsItems.findIndex((item) => item.ckpt_name_str === selectedValue);
        if (idx >= 0) {
            const top = node.__clsScroll ?? 0;
            if (idx < top) node.__clsScroll = idx;
            if (idx >= top + SELECTOR_VISIBLE_ROWS) node.__clsScroll = Math.max(0, idx - SELECTOR_VISIBLE_ROWS + 1);
        }
    } catch (error) {
        node.__clsError = String(error);
    } finally {
        node.__clsLoading = false;
        ensureSelectorSize(node);
        app.graph.setDirtyCanvas(true, true);
    }
}

async function updateCheckpointWidgetsFromObjectInfo() {
    const objectInfoResponse = await api.fetchApi("/object_info");
    const objectInfo = await objectInfoResponse.json();

    const checkpointValues =
        objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ??
        objectInfo?.CheckpointLoaderSimple?.input?.required?.checkpoint_name?.[0] ??
        null;

    if (!Array.isArray(checkpointValues)) {
        return 0;
    }

    const checkpointWidgetNames = new Set([
        "ckpt_name",
        "checkpoint_name",
        "start_checkpoint",
        "checkpoint",
    ]);

    let updated = 0;
    for (const node of app.graph._nodes ?? []) {
        for (const widget of node.widgets ?? []) {
            if (!checkpointWidgetNames.has(widget.name)) continue;
            if (!widget.options) widget.options = {};
            widget.options.values = checkpointValues;
            if (Array.isArray(widget.values)) widget.values = checkpointValues;
            if (widget.value && !checkpointValues.includes(widget.value)) {
                widget.value = checkpointValues[0] ?? "";
            }
            updated += 1;
        }
    }

    app.graph.setDirtyCanvas(true, true);
    return updated;
}

async function refreshAllCheckpointWidgets(node) {
    try {
        node.__clsLoading = true;
        node.__clsError = null;
        app.graph.setDirtyCanvas(true, true);

        await api.fetchApi("/checkpoint_cleanup_handpicker/refresh_checkpoint_widgets", { method: "POST" });
        const updated = await updateCheckpointWidgetsFromObjectInfo();
        await refreshSelectorList(node);
        node.__clsLastRefresh = `Updated ${updated} checkpoint widgets.`;
    } catch (error) {
        node.__clsError = String(error);
    } finally {
        node.__clsLoading = false;
        app.graph.setDirtyCanvas(true, true);
    }
}

function scrollSelector(node, delta) {
    const items = node.__clsItems ?? [];
    const maxScroll = Math.max(0, items.length - SELECTOR_VISIBLE_ROWS);
    node.__clsScroll = Math.max(0, Math.min(maxScroll, (node.__clsScroll ?? 0) + delta));
    app.graph.setDirtyCanvas(true, true);
}


let selectorWheelListenerInstalled = false;

function isSelectorNode(node) {
    return node?.type === SELECTOR_CLASS || node?.comfyClass === SELECTOR_CLASS;
}

function installSelectorWheelListener() {
    if (selectorWheelListenerInstalled) return;
    selectorWheelListenerInstalled = true;

    const canvasEl = app.canvas?.canvas;
    if (!canvasEl) return;

    // ★魔法の鍵：capture: true を追加してLiteGraphより先にイベントを奪う！
    canvasEl.addEventListener(
        "wheel",
        (event) => {
            const canvas = app.canvas;
            const graph = app.graph;
            if (!canvas || !graph) return;

            let graphPos = null;
            try {
                graphPos = canvas.convertEventToCanvasOffset?.(event);
            } catch (error) {
                return;
            }
            if (!graphPos) return;

            const nodes = [...(graph._nodes ?? [])].reverse();
            for (const node of nodes) {
                if (!isSelectorNode(node)) continue;
                if (node.flags?.collapsed) continue;

                // マウス座標をノード内のローカル座標に変換
                const localPos = [
                    graphPos[0] - (node.pos?.[0] ?? 0),
                    graphPos[1] - (node.pos?.[1] ?? 0),
                ];

                const r = selectorListRect(node);
                if (!hitRect(localPos, r)) continue;

                // 🛑【超重要：暗殺魔法】LiteGraphのズーム処理を「完全に」殺す！
                event.preventDefault();
                event.stopPropagation();
                // 同一要素（キャンバス）に登録されているLiteGraphのイベントも強制停止じゃ！
                event.stopImmediatePropagation?.();

                // スクロール処理を実行
                const delta = event.deltaY > 0 ? 3 : -3;
                scrollSelector(node, delta);
                
                return; // 処理完了、ここでループを抜ける
            }
        },
        // ★ここが最大のハックじゃ！ capture: true で先回りする！
        { passive: false, capture: true } 
    );
}

function hitRect(pos, r) {
    return !!pos && pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}

function selectorLocalPositions(node, pos) {
    if (!pos) return [];
    return [
        pos,
        [
            pos[0] - (node.pos?.[0] ?? 0),
            pos[1] - (node.pos?.[1] ?? 0),
        ],
    ];
}

function hitAnyRect(node, pos, rect) {
    return selectorLocalPositions(node, pos).some((p) => hitRect(p, rect));
}

function selectorScrollbarInfo(node) {
    const items = node.__clsItems ?? [];
    if (items.length <= SELECTOR_VISIBLE_ROWS) return null;

    const r = selectorListRect(node);
    const barH = Math.max(24, r.h * (SELECTOR_VISIBLE_ROWS / items.length));
    const maxScroll = Math.max(1, items.length - SELECTOR_VISIBLE_ROWS);
    const scroll = Math.max(0, Math.min(node.__clsScroll ?? 0, maxScroll));
    const barY = r.y + (r.h - barH) * (scroll / maxScroll);
    const trackRect = { x: r.x + r.w - 14, y: r.y, w: 18, h: r.h };
    const thumbRect = { x: r.x + r.w - 14, y: barY, w: 18, h: barH };

    return { listRect: r, trackRect, thumbRect, barH, maxScroll, scroll };
}

function drawSelectorButton(ctx, r, label, enabled = true) {
    ctx.save();
    ctx.fillStyle = enabled ? "rgba(80, 120, 180, 0.65)" : "rgba(80, 80, 80, 0.35)";
    ctx.strokeStyle = enabled ? "rgba(180, 220, 255, 0.75)" : "rgba(160, 160, 160, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(r.x, r.y, r.w, r.h, 6);
    } else {
        ctx.rect(r.x, r.y, r.w, r.h);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = enabled ? "#FFFFFF" : "#999999";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
}

function drawSelector(node, ctx) {
    if (node.flags?.collapsed) return;

    ensureSelectorSize(node);
    const items = node.__clsItems ?? [];
    const selected = selectorSelected(node);
    const scroll = Math.max(0, Math.min(node.__clsScroll ?? 0, Math.max(0, items.length - SELECTOR_VISIBLE_ROWS)));
    node.__clsScroll = scroll;

    ctx.save();

    const buttons = selectorButtonRects(node);
    drawSelectorButton(ctx, buttons.refreshAll, "🔄 Refresh All", !node.__clsLoading);
    drawSelectorButton(ctx, buttons.refreshList, "List only", !node.__clsLoading);
    drawSelectorButton(ctx, buttons.up, "▲", items.length > SELECTOR_VISIBLE_ROWS);
    drawSelectorButton(ctx, buttons.down, "▼", items.length > SELECTOR_VISIBLE_ROWS);

    ctx.fillStyle = node.__clsError ? "#FFD28A" : "#DDDDDD";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const status = node.__clsLoading
        ? "Loading checkpoint list..."
        : node.__clsError
            ? node.__clsError
            : (node.__clsLastRefresh ?? `${items.length} checkpoints · Refresh All also updates CheckpointLoaderSimple widgets`);
    ctx.fillText(status, SELECTOR_MARGIN + 4, 55);

    const r = selectorListRect(node);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "rgba(180, 220, 255, 0.35)";
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();

    for (let row = 0; row < SELECTOR_VISIBLE_ROWS; row++) {
        const idx = scroll + row;
        const item = items[idx];
        const y = r.y + row * SELECTOR_ROW_HEIGHT;

        if (!item) {
            continue;
        }

        const isSelected = item.ckpt_name_str === selected;
        if (isSelected) {
            ctx.fillStyle = "rgba(80, 120, 180, 0.65)";
            ctx.fillRect(r.x + 1, y + 1, r.w - 2, SELECTOR_ROW_HEIGHT - 2);
        } else if (row % 2 === 1) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
            ctx.fillRect(r.x + 1, y, r.w - 2, SELECTOR_ROW_HEIGHT);
        }

        if (item.status === "favorite") {
            ctx.fillStyle = "#FFE58A";
        } else if (item.status === "reserved") {
            ctx.fillStyle = "#FFB0B0";
        } else {
            ctx.fillStyle = "#E6E6E6";
        }

        ctx.font = "12px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label ?? item.ckpt_name_str, r.x + 8, y + SELECTOR_ROW_HEIGHT / 2, r.w - 16);
    }

    ctx.restore();

    const scrollbar = selectorScrollbarInfo(node);
    if (scrollbar) {
        ctx.fillStyle = "rgba(220, 220, 220, 0.18)";
        ctx.fillRect(scrollbar.trackRect.x + 7, scrollbar.trackRect.y, 4, scrollbar.trackRect.h);
        ctx.fillStyle = node.__clsIsDraggingScrollbar ? "rgba(255, 255, 255, 0.70)" : "rgba(220, 220, 220, 0.45)";
        ctx.fillRect(scrollbar.thumbRect.x + 7, scrollbar.thumbRect.y, 4, scrollbar.thumbRect.h);
    }

    ctx.restore();
}

function selectorRowAt(node, pos) {
    const r = selectorListRect(node);
    const p = selectorLocalPositions(node, pos).find((candidate) => hitRect(candidate, r));
    if (!p) return -1;
    const row = Math.floor((p[1] - r.y) / SELECTOR_ROW_HEIGHT);
    const idx = (node.__clsScroll ?? 0) + row;
    const items = node.__clsItems ?? [];
    return idx >= 0 && idx < items.length ? idx : -1;
}

function setupSelectorNode(nodeType) {
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
        hideCheckpointWidget(this);
        ensureSelectorSize(this);
        this.__clsItems = [];
        this.__clsScroll = 0;
        this.__clsIsDraggingScrollbar = false;
        this.__clsDragStartY = 0;
        this.__clsDragStartScroll = 0;
        setTimeout(() => refreshSelectorList(this), 0);
        return result;
    };

    const origOnDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
        if (origOnDrawBackground) {
            origOnDrawBackground.apply(this, arguments);
        }
        hideCheckpointWidget(this);
        drawSelector(this, ctx);
    };

    const origOnMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        const buttons = selectorButtonRects(this);
        if (hitAnyRect(this, pos, buttons.refreshAll)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            refreshAllCheckpointWidgets(this);
            return true;
        }
        if (hitAnyRect(this, pos, buttons.refreshList)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            refreshSelectorList(this);
            return true;
        }
        if (hitAnyRect(this, pos, buttons.up)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            scrollSelector(this, -SELECTOR_VISIBLE_ROWS);
            return true;
        }
        if (hitAnyRect(this, pos, buttons.down)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            scrollSelector(this, SELECTOR_VISIBLE_ROWS);
            return true;
        }

        const scrollbar = selectorScrollbarInfo(this);
        if (scrollbar) {
            const hitPositions = selectorLocalPositions(this, pos);
            const thumbHitPos = hitPositions.find((p) => hitRect(p, scrollbar.thumbRect));
            const trackHitPos = hitPositions.find((p) => hitRect(p, scrollbar.trackRect));

            if (thumbHitPos) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                this.__clsIsDraggingScrollbar = true;
                this.__clsDragStartY = thumbHitPos[1];
                this.__clsDragStartScroll = scrollbar.scroll;
                return true;
            }

            if (trackHitPos) {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                if (trackHitPos[1] < scrollbar.thumbRect.y) {
                    scrollSelector(this, -SELECTOR_VISIBLE_ROWS);
                } else {
                    scrollSelector(this, SELECTOR_VISIBLE_ROWS);
                }
                return true;
            }
        }

        const idx = selectorRowAt(this, pos);
        if (idx >= 0) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const item = this.__clsItems[idx];
            setSelectorSelected(this, item.ckpt_name_str);
            return true;
        }

        if (origOnMouseDown) {
            return origOnMouseDown.apply(this, arguments);
        }
        return false;
    };

    const origOnMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos, canvas) {
        if (this.__clsIsDraggingScrollbar && event?.buttons === 0) {
            this.__clsIsDraggingScrollbar = false;
            app.graph.setDirtyCanvas(true, true);
            return true;
        }

        if (this.__clsIsDraggingScrollbar) {
            event?.preventDefault?.();
            event?.stopPropagation?.();

            const scrollbar = selectorScrollbarInfo(this);
            if (!scrollbar) {
                this.__clsIsDraggingScrollbar = false;
                app.graph.setDirtyCanvas(true, true);
                return true;
            }

            const positions = selectorLocalPositions(this, pos);
            const p = positions.find((candidate) => hitRect(candidate, selectorListRect(this))) ?? positions[0];
            if (!p) return true;

            const deltaY = p[1] - this.__clsDragStartY;
            const scrollRange = scrollbar.listRect.h - scrollbar.barH;
            if (scrollRange > 0) {
                const deltaScroll = (deltaY / scrollRange) * scrollbar.maxScroll;
                this.__clsScroll = Math.max(
                    0,
                    Math.min(scrollbar.maxScroll, Math.round(this.__clsDragStartScroll + deltaScroll))
                );
                app.graph.setDirtyCanvas(true, true);
            }
            return true;
        }

        if (origOnMouseMove) {
            return origOnMouseMove.apply(this, arguments);
        }
        return false;
    };

    const origOnMouseUp = nodeType.prototype.onMouseUp;
    nodeType.prototype.onMouseUp = function (event, pos, canvas) {
        if (this.__clsIsDraggingScrollbar) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            this.__clsIsDraggingScrollbar = false;
            app.graph.setDirtyCanvas(true, true);
            return true;
        }

        if (origOnMouseUp) {
            return origOnMouseUp.apply(this, arguments);
        }
        return false;
    };

    const origOnMouseWheel = nodeType.prototype.onMouseWheel;
    nodeType.prototype.onMouseWheel = function (event, pos, canvas) {
        const r = selectorListRect(this);
        const localPos = pos
            ? [
                pos[0] - (this.pos?.[0] ?? 0),
                pos[1] - (this.pos?.[1] ?? 0),
            ]
            : null;

        if (hitRect(localPos, r) || hitRect(pos, r)) {
            event?.preventDefault?.();
            event?.stopPropagation?.();

            const delta = event.deltaY > 0 ? 3 : -3;
            scrollSelector(this, delta);
            return true;
        }

        if (origOnMouseWheel) {
            return origOnMouseWheel.apply(this, arguments);
        }
        return false;
    };
}

function setupReviewNode(nodeType) {
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
        ensureNodeSize(this);
        return result;
    };

    const origOnDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
        if (origOnDrawBackground) {
            origOnDrawBackground.apply(this, arguments);
        }
        drawPreview(this, ctx);
    };

    const origOnMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        const button = hitButton(this, pos);
        if (button) {
            if (button.enabled) {
                postAction(this, button.action);
            } else {
                this.__ccrMessage = "This action is currently disabled.";
                app.graph.setDirtyCanvas(true, true);
            }
            return true;
        }

        if (origOnMouseDown) {
            return origOnMouseDown.apply(this, arguments);
        }
        return false;
    };
}


function hideWidgetByName(node, name) {
    const w = node.widgets?.find((widget) => widget.name === name);
    if (!w) return;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
}

const TAGGER_MIN_WIDTH = 420;
const TAGGER_MIN_HEIGHT = 150;
const TAGGER_BODY_Y = 48;

function ensureTaggerSize(node) {
    if (!node.size) return;
    node.size[0] = Math.max(node.size[0], TAGGER_MIN_WIDTH);
    node.size[1] = Math.max(node.size[1], TAGGER_MIN_HEIGHT);
}

function currentTaggerPayload(node) {
    return {
        ckpt_name_str: node.__cctState?.ckpt_name_str ?? getInputValue(node, "ckpt_name_str"),
    };
}

async function postTaggerAction(node, action) {
    try {
        const response = await api.fetchApi(`/checkpoint_cleanup_handpicker/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentTaggerPayload(node)),
        });
        const result = await response.json();
        node.__cctMessage = result.ok ? "OK" : (result.error || "Action failed.");
        node.__cctState = { ...(node.__cctState ?? {}), ...result };
        if (result.title) {
            node.title = result.title;
        }
        app.graph.setDirtyCanvas(true, true);
    } catch (error) {
        node.__cctMessage = String(error);
        app.graph.setDirtyCanvas(true, true);
    }
}

function taggerButtonDefs(node) {
    const s = node.__cctState ?? {};
    return [
        { label: "💛 お気に入り", action: "tagger_favorite", enabled: !!s.can_favorite },
        { label: "解除", action: "tagger_unfavorite", enabled: !!s.can_unfavorite },
        { label: "🗑 削除予約", action: "tagger_reserve_delete", enabled: !!s.can_reserve_delete },
        { label: "予約取消", action: "tagger_cancel_delete", enabled: !!s.can_cancel_delete },
    ];
}

function taggerButtonRects(node) {
    const defs = taggerButtonDefs(node);
    const x = Math.min(TOP_CONTROL_X, Math.max(PREVIEW_MARGIN, node.size[0] * 0.38));
    const y = TOP_CONTROL_Y;
    const w = Math.max(1, node.size[0] - x - PREVIEW_MARGIN);
    const h = BUTTON_BAR_HEIGHT;
    const count = defs.length;
    const buttonWidth = Math.max(70, (w - BUTTON_GAP * (count - 1)) / count);
    return defs.map((button, index) => ({
        ...button,
        x: x + index * (buttonWidth + BUTTON_GAP),
        y,
        w: buttonWidth,
        h,
    }));
}

function drawTaggerButtons(node, ctx) {
    const rects = taggerButtonRects(node);
    ctx.save();
    for (const r of rects) {
        ctx.fillStyle = r.enabled ? "rgba(80, 120, 180, 0.65)" : "rgba(80, 80, 80, 0.35)";
        ctx.strokeStyle = r.enabled ? "rgba(180, 220, 255, 0.75)" : "rgba(160, 160, 160, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(r.x, r.y, r.w, r.h, 6);
        } else {
            ctx.rect(r.x, r.y, r.w, r.h);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = r.enabled ? "#FFFFFF" : "#999999";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2);
    }
    ctx.restore();
}

function hitTaggerButton(node, pos) {
    for (const r of taggerButtonRects(node)) {
        if (pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h) {
            return r;
        }
    }
    return null;
}

function shortTaggerText(text, maxLength = 54) {
    const value = String(text ?? "");
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function drawTagger(node, ctx) {
    if (node.flags?.collapsed) return;
    hideWidgetByName(node, "ckpt_name_str");
    const state = node.__cctState ?? {};
    ctx.save();
    drawTaggerButtons(node, ctx);
    const infoX = PREVIEW_MARGIN;
    const infoY = TAGGER_BODY_Y;
    const infoW = Math.max(1, node.size[0] - PREVIEW_MARGIN * 2);
    const infoH = Math.max(1, node.size[1] - infoY - PREVIEW_MARGIN);
    ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    ctx.fillRect(infoX, infoY, infoW, infoH);
    ctx.fillStyle = "#E8E8E8";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const statusText = state.is_favorite ? "💛 Favorite" : (state.is_reserved ? "🗑 Reserved" : (state.status ? state.status : "unreviewed"));
    ctx.fillText(`Status: ${statusText}`, infoX + 8, infoY + 18);
    ctx.fillText(`Checkpoint: ${shortTaggerText(state.ckpt_name_str || getInputValue(node, "ckpt_name_str"))}`, infoX + 8, infoY + 38);
    const msg = node.__cctMessage || state.message || "Use this node while watching KSampler / Preview Tap output.";
    ctx.fillStyle = node.__cctMessage ? "#FFD28A" : "#CFCFCF";
    ctx.fillText(shortTaggerText(msg, 80), infoX + 8, infoY + 58);
    ctx.restore();
}

function setupTaggerNode(nodeType) {
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
        hideWidgetByName(this, "ckpt_name_str");
        ensureTaggerSize(this);
        return result;
    };

    const origOnDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function (ctx) {
        if (origOnDrawBackground) {
            origOnDrawBackground.apply(this, arguments);
        }
        drawTagger(this, ctx);
    };

    const origOnMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        const button = hitTaggerButton(this, pos);
        if (button) {
            if (button.enabled) {
                postTaggerAction(this, button.action);
            } else {
                this.__cctMessage = "This action is currently disabled.";
                app.graph.setDirtyCanvas(true, true);
            }
            return true;
        }
        if (origOnMouseDown) {
            return origOnMouseDown.apply(this, arguments);
        }
        return false;
    };
}

app.registerExtension({
    name: EXTENSION_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === REVIEW_CLASS) {
            setupReviewNode(nodeType);
            return;
        }

        if (nodeData.name === SELECTOR_CLASS) {
            installSelectorWheelListener();
            setupSelectorNode(nodeType);
            return;
        }

        if (nodeData.name === TAGGER_CLASS) {
            setupTaggerNode(nodeType);
            return;
        }
    },
});
