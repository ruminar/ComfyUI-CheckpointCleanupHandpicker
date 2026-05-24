import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "ruminar.checkpoint_cleanup_handpicker";
const EVENT_NAME = "ruminar.checkpoint_cleanup_review";
const TARGET_CLASS = "CheckpointCleanupReview";

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

app.registerExtension({
    name: EXTENSION_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET_CLASS) return;

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
    },
});
