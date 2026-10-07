import { jsPDF } from 'jspdf';
import { formatValue, kindName, type Annotation, type DamageLayer } from '../types/project';

export interface ReportInput {
  projectName: string;
  unit: string;
  modelName: string | null;
  layers: DamageLayer[];
  annotations: Annotation[];
  screenshot: string | null;
}

const PAGE_W = 595; // A4 in pt
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [150, 150, 150];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function annotationValue(a: Annotation, unit: string): string | null {
  if (a.kind === 'measure' && a.distance !== undefined) return `${formatValue(a.distance)} ${unit}`;
  if (a.kind === 'area' && a.area !== undefined) return `${formatValue(a.area)} ${unit}²`;
  return null;
}

export function exportReport(input: ReportInput): void {
  const { projectName, unit, modelName, layers, annotations, screenshot } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // ---- header ---------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('3D Artwork Condition Report', MARGIN, y);
  y += 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Project: ${projectName}`, MARGIN, y);
  y += 14;
  doc.text(`Model: ${modelName ?? '—'}`, MARGIN, y);
  y += 14;
  doc.text(`Date: ${new Date().toLocaleString()}`, MARGIN, y);
  y += 14;
  doc.text(`Units: ${unit} (length) · ${unit}² (area)`, MARGIN, y);
  y += 20;
  doc.setTextColor(0, 0, 0);

  // ---- screenshot -----------------------------------------------------------
  if (screenshot) {
    try {
      const props = doc.getImageProperties(screenshot);
      const width = CONTENT_W;
      const height = Math.min((width * props.height) / props.width, 300);
      ensureSpace(height + 10);
      doc.addImage(screenshot, 'PNG', MARGIN, y, width, height);
      y += height + 18;
    } catch {
      // Screenshot is best-effort; continue without it.
    }
  }

  // ---- layer summary --------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Damage layers', MARGIN, y);
  y += 16;

  doc.setFontSize(10);
  for (const layer of layers) {
    const count = annotations.filter((a) => a.layerId === layer.id).length;
    ensureSpace(16);
    const [r, g, b] = hexToRgb(layer.color);
    doc.setFillColor(r, g, b);
    doc.rect(MARGIN, y - 7, 9, 9, 'F');
    doc.setFont('helvetica', 'normal');
    doc.text(`${layer.name} — ${count} annotation(s)`, MARGIN + 16, y);
    y += 14;
  }
  y += 12;

  // ---- findings per layer ---------------------------------------------------
  const layersWithContent = layers.filter((l) => annotations.some((a) => a.layerId === l.id));
  const orphanAnnotations = annotations.filter((a) => !layers.some((l) => l.id === a.layerId));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  ensureSpace(20);
  doc.text('Findings', MARGIN, y);
  y += 18;

  const renderAnnotation = (a: Annotation, index: number) => {
    const value = annotationValue(a, unit);
    ensureSpace(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const header = `${index + 1}. ${a.label}  [${kindName(a.kind)}]${value ? `  —  ${value}` : ''}`;
    doc.text(header, MARGIN + 8, y);
    y += 13;
    if (a.notes.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(70, 70, 70);
      const lines = doc.splitTextToSize(a.notes.trim(), CONTENT_W - 16) as string[];
      for (const line of lines) {
        ensureSpace(13);
        doc.text(line, MARGIN + 16, y);
        y += 12;
      }
      doc.setTextColor(0, 0, 0);
    }
    y += 6;
  };

  for (const layer of layersWithContent) {
    ensureSpace(22);
    const [r, g, b] = hexToRgb(layer.color);
    doc.setFillColor(r, g, b);
    doc.rect(MARGIN, y - 8, 10, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(layer.name, MARGIN + 16, y);
    y += 16;
    annotations.filter((a) => a.layerId === layer.id).forEach(renderAnnotation);
    y += 6;
  }

  if (orphanAnnotations.length > 0) {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Unassigned', MARGIN, y);
    y += 16;
    orphanAnnotations.forEach(renderAnnotation);
  }

  // ---- page footers ---------------------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Generated by 3D Artwork Annotator (open source) — page ${i} / ${pageCount}`, MARGIN, PAGE_H - 20);
  }

  const fileBase = projectName.replace(/[^\w\- ]+/g, '').trim() || 'project';
  doc.save(`${fileBase}-report.pdf`);
}
