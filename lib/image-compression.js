import {
    canvasToFile,
    cleanupCanvasMemory,
    drawFileInCanvas,
    followExifOrientation,
    getExifOrientation,
    getNewCanvasAndCtx,
    handleMaxWidthOrHeight,
    isAutoOrientationInBrowser,
} from './utils';

/**
 * Compress an image file.
 *
 * @param {File} file
 * @param {Object} options
 * @param {number} [options.maxSizeMB=Number.POSITIVE_INFINITY]
 * @param {number} [options.maxWidthOrHeight=undefined]
 * @param {boolean} [options.useWebWorker=false]
 * @param {number} [options.maxIteration=10]
 * @param {number} [options.exifOrientation] - default to be the exif orientation from the image file
 * @param {Function} [options.onProgress] - a function takes one progress argument (progress from 0 to 100)
 * @param {string} [options.fileType] - default to be the original mime type from the image file
 * @param {number} [options.initialQuality=1.0]
 * @param {number} previousProgress - for internal try catch rerunning start from previous progress
 * @returns {Promise<File | Blob>}
 */
export default async function compress(file, options, previousProgress = 0) {
    let progress = previousProgress;

    function incProgress(inc = 5) {
        progress += inc;
        options.onProgress(Math.min(progress, 100));
    }

    function setProgress(p) {
        progress = Math.min(Math.max(p, progress), 100);
        options.onProgress(progress);
    }

    let remainingTrials = options.maxIteration || 10;

    const maxSizeByte = options.maxSizeMB * 1024 * 1024;

    incProgress();

    // drawFileInCanvas
    const [, origCanvas] = await drawFileInCanvas(file);

    incProgress();

    // handleMaxWidthOrHeight
    const maxWidthOrHeightFixedCanvas = handleMaxWidthOrHeight(origCanvas, options);

    incProgress();

    // exifOrientation
    const exifOrientation = options.exifOrientation || await getExifOrientation(file);
    incProgress();
    const orientationFixedCanvas = (await isAutoOrientationInBrowser()) ? maxWidthOrHeightFixedCanvas : followExifOrientation(maxWidthOrHeightFixedCanvas, exifOrientation);
    incProgress();

    let quality = options.initialQuality || 1.0;

    const outputFileType = options.fileType || file.type;

    var tempFile = await canvasToFile(orientationFixedCanvas, outputFileType, file.name, file.lastModified, quality);

    //compress failed, return the original file
    if (tempFile == null) {
        tempFile = file;
    }

    incProgress();

    const origExceedMaxSize = tempFile.size > maxSizeByte;
    const sizeBecomeLarger = tempFile.size > file.size;
    if (process.env.BUILD === 'development') {
        console.log('original file size', file.size);
        console.log('current file size', tempFile.size);
    }

    // check if we need to compress or resize
    if (!origExceedMaxSize && !sizeBecomeLarger) {
        // no need to compress
        if (process.env.BUILD === 'development') {
            console.log('no need to compress');
        }
        setProgress(100);
        return tempFile;
    }

    const sourceSize = file.size;
    const renderedSize = tempFile.size;
    let currentSize = renderedSize;
    let compressedFile;
    let newCanvas;
    let
        ctx;
    let canvas = orientationFixedCanvas;
    while (remainingTrials-- && (currentSize > maxSizeByte || currentSize > sourceSize)) {
        const newWidth = origExceedMaxSize ? canvas.width * 0.95 : canvas.width;
        const newHeight = origExceedMaxSize ? canvas.height * 0.95 : canvas.height;
        if (process.env.BUILD === 'development') {
            console.log('current width', newWidth);
            console.log('current height', newHeight);
        }
        [newCanvas, ctx] = getNewCanvasAndCtx(newWidth, newHeight);

        ctx.drawImage(canvas, 0, 0, newWidth, newHeight);

        quality *= 0.95;
        // eslint-disable-next-line no-await-in-loop
        compressedFile = await canvasToFile(newCanvas, outputFileType, file.name, file.lastModified, quality);

        cleanupCanvasMemory(canvas);

        canvas = newCanvas;

        currentSize = compressedFile.size;
        // console.log('currentSize', currentSize)
        setProgress(Math.min(99, Math.floor(((renderedSize - currentSize) / (renderedSize - maxSizeByte)) * 100)));
    }

    cleanupCanvasMemory(canvas);
    cleanupCanvasMemory(newCanvas);
    cleanupCanvasMemory(maxWidthOrHeightFixedCanvas);
    cleanupCanvasMemory(orientationFixedCanvas);
    cleanupCanvasMemory(origCanvas);

    setProgress(100);
    return compressedFile;
}