import React, { useState, useRef } from 'react';
import { Trash2, Type, Image, QrCode, Hash, Calendar, Signature, Square, Minus, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export interface TemplateElement {
  id: string;
  type: 'text' | 'image' | 'qr' | 'barcode' | 'signature' | 'date' | 'consecutive' | 'shape' | 'line';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  color?: string;
  fontFamily?: string;
  imageUrl?: string;
  fieldKey?: string;
}

export interface CanvasMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TemplateCanvasProps {
  elements: TemplateElement[];
  onChange: (elements: TemplateElement[]) => void;
  pageOrientation?: 'portrait' | 'landscape';
  onImageUpload?: (file: File) => Promise<string>;
  onSelectElement?: (element: TemplateElement | null) => void;
  selectedElementId?: string | null;
  margins?: CanvasMargins;
}

const DEFAULT_ELEMENTS: Record<string, Partial<TemplateElement>> = {
  text: { type: 'text', width: 200, height: 60, content: 'Texto', fontSize: 16, align: 'center' },
  image: { type: 'image', width: 120, height: 80, content: 'Logo', imageUrl: '' },
  qr: { type: 'qr', width: 80, height: 80, content: '{{codigo_certificado}}' },
  signature: { type: 'signature', width: 150, height: 50, content: 'Firma' },
  date: { type: 'date', width: 150, height: 30, content: '{{fecha_certificacion}}', fontSize: 12 },
  consecutive: { type: 'consecutive', width: 180, height: 30, content: '{{radicado}}', fontSize: 12 },
  line: { type: 'line', width: 300, height: 2, content: '' },
  shape: { type: 'shape', width: 100, height: 100, content: '' },
};

const TOOLS = [
  { type: 'text', icon: Type, label: 'Texto' },
  { type: 'image', icon: Image, label: 'Logo' },
  { type: 'qr', icon: QrCode, label: 'QR' },
  { type: 'signature', icon: Signature, label: 'Firma' },
  { type: 'date', icon: Calendar, label: 'Fecha' },
  { type: 'consecutive', icon: Hash, label: 'Consecutivo' },
  { type: 'line', icon: Minus, label: 'Línea' },
  { type: 'shape', icon: Square, label: 'Forma' },
];

export function TemplateCanvas({
  elements,
  onChange,
  pageOrientation,
  onImageUpload,
  onSelectElement,
  selectedElementId,
  margins,
}: TemplateCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const width = pageOrientation === 'landscape' ? 842 : 595;
  const height = pageOrientation === 'landscape' ? 595 : 842;
  const scale = 0.6;

  const addElement = (type: string) => {
    const defaults = DEFAULT_ELEMENTS[type];
    if (!defaults) return;

    if (type === 'image') {
      fileInputRef.current?.click();
      return;
    }

    const newElement: TemplateElement = {
      id: `el-${Date.now()}`,
      ...defaults,
      x: 50 + Math.random() * 80,
      y: 50 + Math.random() * 80,
    } as TemplateElement;
    onChange([...elements, newElement]);
    onSelectElement?.(newElement);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImageUpload) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Solo se permiten imágenes');
      return;
    }

    try {
      const url = await onImageUpload(file);
      const newElement: TemplateElement = {
        id: `el-${Date.now()}`,
        type: 'image',
        x: 50 + Math.random() * 80,
        y: 50 + Math.random() * 80,
        width: 120,
        height: 80,
        content: file.name,
        imageUrl: url,
      };
      onChange([...elements, newElement]);
      onSelectElement?.(newElement);
      toast.success('Logo agregado al canvas');
    } catch (err: any) {
      toast.error('Error al subir logo: ' + err.message);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectElement = (id: string | null) => {
    if (id) {
      const el = elements.find(e => e.id === id);
      onSelectElement?.(el || null);
    } else {
      onSelectElement?.(null);
    }
  };

  const removeElement = (id: string) => {
    onChange(elements.filter(el => el.id !== id));
    if (selectedElementId === id) selectElement(null);
  };

  const updateElement = (id: string, updates: Partial<TemplateElement>) => {
    onChange(elements.map(el => (el.id === id ? { ...el, ...updates } : el)));
  };

  // --- DRAG ---
  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    if (editingId) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elements.find(el => el.id === id);
    if (!el) return;
    selectElement(id);

    const target = e.target as HTMLElement;
    if (target.classList.contains('resize-handle')) return;

    // Store initial state — drag only starts after moving > 5px threshold
    dragRef.current = {
      id,
      offsetX: e.clientX / scale - el.x,
      offsetY: e.clientY / scale - el.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = Math.abs(e.clientX - dragRef.current.startX);
      const dy = Math.abs(e.clientY - dragRef.current.startY);

      // Require 5px movement before starting drag
      if (!dragRef.current.moved && (dx < 5 && dy < 5)) return;
      dragRef.current.moved = true;

      const newX = Math.max(0, e.clientX / scale - dragRef.current.offsetX);
      const newY = Math.max(0, e.clientY / scale - dragRef.current.offsetY);
      updateElement(dragRef.current.id, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // --- RESIZE ---
  const handleResizeStart = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = elements.find(el => el.id === id);
    if (!el) return;

    resizeRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startW: el.width,
      startH: el.height,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = (e.clientX - resizeRef.current.startX) / scale;
      const dy = (e.clientY - resizeRef.current.startY) / scale;
      const newW = Math.max(20, resizeRef.current.startW + dx);
      const newH = Math.max(10, resizeRef.current.startH + dy);
      updateElement(resizeRef.current.id, { width: newW, height: newH });
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // --- INLINE TEXT EDITING ---
  const startEditing = (el: TemplateElement) => {
    if (el.type !== 'text' && el.type !== 'date' && el.type !== 'consecutive') return;
    setEditingId(el.id);
    setEditValue(el.content);
  };

  const finishEditing = () => {
    if (editingId) {
      updateElement(editingId, { content: editValue });
    }
    setEditingId(null);
    setEditValue('');
  };

  const handleDoubleClick = (e: React.MouseEvent, el: TemplateElement) => {
    e.stopPropagation();
    if (el.type === 'text' || el.type === 'date' || el.type === 'consecutive') {
      startEditing(el);
    }
  };

  // --- DESELECT ON CANVAS CLICK ---
  const handleCanvasClick = () => {
    selectElement(null);
  };

  // --- RENDER ELEMENT ---
  const renderElement = (el: TemplateElement) => {
    const isSelected = selectedElementId === el.id;
    const isEditing = editingId === el.id;
    const isTextType = el.type === 'text' || el.type === 'date' || el.type === 'consecutive';

    return (
      <div
        key={el.id}
        className={`absolute group ${isSelected ? 'z-10 cursor-move' : 'z-0 cursor-default'}`}
        style={{
          left: el.x * scale,
          top: el.y * scale,
          width: el.width * scale,
          height: el.height * scale,
        }}
        onMouseDown={(e) => handleMouseDown(e, el.id)}
        onDoubleClick={(e) => handleDoubleClick(e, el)}
      >
        {/* Selection outline */}
        {isSelected && (
          <div className="absolute -inset-[3px] border-2 border-primary rounded-sm pointer-events-none" />
        )}

        <div
          className={`w-full h-full text-xs ${
            el.type === 'image' && el.imageUrl
              ? ''
              : isSelected
                ? 'bg-white/90 border border-primary/40'
                : 'bg-white/80 border border-dashed border-outline-variant'
          }`}
          style={{
            fontSize: (el.fontSize || 14) * scale,
            fontWeight: el.bold ? 'bold' : 'normal',
            fontStyle: el.italic ? 'italic' : 'normal',
            textAlign: el.align || 'left',
            color: el.color || '#3d4a3d',
            overflow: 'hidden',
          }}
        >
          {el.type === 'image' && el.imageUrl ? (
            <img src={el.imageUrl} alt={el.content} className="w-full h-full object-contain" />
          ) : el.type === 'image' ? (
            <div className="flex items-center justify-center w-full h-full bg-surface-container-low text-on-surface-variant text-[10px] flex-col gap-1">
              <Upload size={12} />
              <span>Logo</span>
            </div>
          ) : el.type === 'qr' ? (
            <div className="flex items-center justify-center w-full h-full bg-white">
              <div
                className="w-3/4 h-3/4 bg-neutral-900/10"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg, transparent, transparent 2px, #000 2px, #000 4px), repeating-linear-gradient(90deg, transparent, transparent 2px, #000 2px, #000 4px)',
                  backgroundSize: '6px 6px',
                }}
              />
            </div>
          ) : el.type === 'line' ? (
            <div className="w-full h-full flex items-center">
              <div className="w-full border-t-2 border-outline" />
            </div>
          ) : el.type === 'shape' ? (
            <div className="w-full h-full border-2 border-outline rounded" />
          ) : isEditing ? (
            <textarea
              className="w-full h-full bg-transparent resize-none outline-none p-1 leading-tight"
              style={{
                fontSize: (el.fontSize || 14) * scale,
                fontWeight: el.bold ? 'bold' : 'normal',
                fontStyle: el.italic ? 'italic' : 'normal',
                textAlign: el.align || 'left',
                color: el.color || '#3d4a3d',
                fontFamily: el.fontFamily || 'inherit',
                overflow: 'auto',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={finishEditing}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditingId(null);
                  setEditValue('');
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  finishEditing();
                }
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className="w-full h-full p-1 leading-tight"
              style={{
                overflow: 'hidden',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: '999',
                WebkitBoxOrient: 'vertical',
              }}
            >
              {el.content}
            </div>
          )}
        </div>

        {/* Selection controls */}
        {isSelected && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); removeElement(el.id); }}
              className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-error text-on-error rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-md hover:scale-110"
            >
              <Trash2 size={10} />
            </button>
            <div
              className="resize-handle absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-primary border-2 border-white rounded-sm shadow-sm cursor-se-resize z-20 hover:scale-125 transition-transform"
              onMouseDown={(e) => handleResizeStart(e, el.id)}
            />
            <div className="absolute -top-5 left-0 text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap capitalize pointer-events-none">
              {el.type === 'consecutive' ? 'Consec.' : el.type}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      {/* Side toolbar */}
      <div className="w-16 shrink-0">
        <div className="glass-card p-1.5 rounded-xl space-y-1 border border-white/40">
          {TOOLS.map((tool) => (
            <button
              key={tool.type}
              onClick={() => addElement(tool.type)}
              className="w-full flex flex-col items-center gap-0.5 p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-colors"
              title={tool.label}
            >
              <tool.icon size={16} />
              <span className="text-[10px] leading-none">{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas area */}
      <div
        className="flex-1 overflow-auto bg-surface-container-low rounded-2xl p-4"
        ref={canvasRef}
        onClick={handleCanvasClick}
      >
        <div
          className="mx-auto bg-white shadow-xl rounded-sm overflow-hidden relative"
          style={{ width: width * scale, height: height * scale }}
        >
          <div
            className="absolute inset-0 opacity-[0.02] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, #006e2f 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />

          {/* Margin guides */}
          {margins && (
            <>
              {/* Top margin zone */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: 0,
                  left: 0,
                  right: 0,
                  height: margins.top * scale,
                  background: 'repeating-linear-gradient(135deg, rgba(186,26,26,0.04), rgba(186,26,26,0.04) 8px, transparent 8px, transparent 16px)',
                  borderBottom: '1px dashed rgba(186,26,26,0.25)',
                  zIndex: 1,
                }}
              />
              {/* Bottom margin zone */}
              <div
                className="absolute pointer-events-none"
                style={{
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: margins.bottom * scale,
                  background: 'repeating-linear-gradient(135deg, rgba(186,26,26,0.04), rgba(186,26,26,0.04) 8px, transparent 8px, transparent 16px)',
                  borderTop: '1px dashed rgba(186,26,26,0.25)',
                  zIndex: 1,
                }}
              />
              {/* Left margin zone */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: margins.top * scale,
                  left: 0,
                  width: margins.left * scale,
                  height: (height - margins.top - margins.bottom) * scale,
                  background: 'repeating-linear-gradient(135deg, rgba(186,26,26,0.04), rgba(186,26,26,0.04) 8px, transparent 8px, transparent 16px)',
                  borderRight: '1px dashed rgba(186,26,26,0.25)',
                  zIndex: 1,
                }}
              />
              {/* Right margin zone */}
              <div
                className="absolute pointer-events-none"
                style={{
                  top: margins.top * scale,
                  right: 0,
                  width: margins.right * scale,
                  height: (height - margins.top - margins.bottom) * scale,
                  background: 'repeating-linear-gradient(135deg, rgba(186,26,26,0.04), rgba(186,26,26,0.04) 8px, transparent 8px, transparent 16px)',
                  borderLeft: '1px dashed rgba(186,26,26,0.25)',
                  zIndex: 1,
                }}
              />
              {/* Inner safe-area label */}
              <div
                className="absolute pointer-events-none text-[8px] font-bold text-red-300/40 uppercase tracking-wider"
                style={{
                  top: Math.max(margins.top * scale - 14, 2),
                  left: margins.left * scale + 4,
                  zIndex: 2,
                }}
              >
                Área segura
              </div>
            </>
          )}

          {elements.map(renderElement)}

          {elements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant/40">
              <div className="text-center">
                <p className="text-body-lg font-medium">Plantilla vacía</p>
                <p className="text-body-md">Agrega elementos desde la barra lateral</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
