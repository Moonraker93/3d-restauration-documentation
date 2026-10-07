// Stub for the optional jsPDF dependency "canvg" (SVG rasterization).
// This app never calls doc.svg(), and jsPDF only uses canvg when the module
// resolves to a value. Exporting undefined makes jsPDF skip the feature.
export default undefined;
