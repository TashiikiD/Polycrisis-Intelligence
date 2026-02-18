export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
    return a + ((b - a) * t);
}

export function scaleCanvas(canvas) {
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height, dpr };
}

export function pointerPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

export function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

export function formatNumber(value, digits = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return value.toFixed(digits);
}

export function nearestIndexByX(points, xValueAccessor, x) {
    if (!Array.isArray(points) || points.length === 0) return -1;

    let bestIdx = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
        const px = xValueAccessor(points[i], i);
        const distance = Math.abs(px - x);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIdx = i;
        }
    }
    return bestIdx;
}
