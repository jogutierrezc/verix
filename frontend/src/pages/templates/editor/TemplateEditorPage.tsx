import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase, STORAGE } from '../../../lib/supabase';
import { TemplateCanvas, TemplateElement } from '../../../components/editor/TemplateCanvas';
import {
  Save,
  ArrowLeft,
  Code,
  List,
  Upload,
  Image as ImageIcon,
  Trash2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight, AlignJustify, Move, Maximize, Type, Layers
} from 'lucide-react';
import toast from 'react-hot-toast';

const CERTIFICATE_VARIABLES = [
  { key: 'codigo_certificado', label: 'Código del Certificado', desc: 'Código único por documento (UUID auto)' },
  { key: 'radicado', label: 'Radicado', desc: 'Consecutivo numérico del documento' },
  { key: 'nombre_estudiante', label: 'Nombre del Estudiante', desc: 'Nombre completo del estudiante' },
  { key: 'documento_estudiante', label: 'No. Documento', desc: 'Número de identificación' },
  { key: 'tipo_seminario', label: 'Tipo de Seminario', desc: 'Nombre del seminario/curso' },
  { key: 'intensidad_horaria', label: 'Intensidad Horaria', desc: 'Horas del curso (ej: 40 horas)' },
  { key: 'estado_evaluacion', label: 'Estado Evaluación', desc: 'Aprobado/Reprobado' },
  { key: 'fecha_inicio', label: 'Fecha de Inicio', desc: 'Inicio del periodo académico' },
  { key: 'fecha_terminacion', label: 'Fecha de Terminación', desc: 'Fin del periodo académico' },
  { key: 'fecha_certificacion', label: 'Fecha de Certificación', desc: 'Fecha de expedición del certificado' },
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48];
const COLORS = [
  '#191c1e', '#3d4a3d', '#006e2f', '#9d4300', '#565e74',
  '#ba1a1a', '#1a6bba', '#7b1fa2', '#00897b', '#e65100',
];

function PropertiesPanel({
  element,
  onUpdate,
  onDelete,
  onImageUpload,
}: {
  element: TemplateElement;
  onUpdate: (updates: Partial<TemplateElement>) => void;
  onDelete: () => void;
  onImageUpload?: (file: File) => Promise<string>;
}) {
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
          <Type size={14} />
          Propiedades
        </h4>
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-error/10 rounded-lg text-error transition-colors"
          title="Eliminar elemento"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="space-y-0.5 text-xs text-on-surface-variant/60">
        <p className="capitalize">Tipo: <span className="font-semibold text-on-surface">{element.type}</span></p>
        {element.fieldKey && (
          <p>Campo: <span className="font-semibold text-on-surface">{element.fieldKey}</span></p>
        )}
      </div>

      <hr className="border-outline-variant/20" />

      {/* Content (for text types) */}
      {(element.type === 'text' || element.type === 'date' || element.type === 'consecutive') && (
        <div>
          <label className="label">Contenido</label>
          <textarea
            className="input resize-none h-20 text-sm"
            value={element.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            placeholder="Texto o {{variable}}"
          />
        </div>
      )}

      {/* Image replace */}
      {element.type === 'image' && (          <div>
            <label className="label">Imagen</label>
            {element.imageUrl ? (
              <div className="relative group">
                <img src={element.imageUrl} alt="" className="w-full h-24 object-contain bg-white/50 rounded-xl border border-outline-variant p-2" />
                <button
                  onClick={() => document.getElementById(`prop-image-upload-${element.id}`)?.click()}
                  className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-sm font-medium"
                >
                  Cambiar imagen
                </button>
              </div>
            ) : (
              <div className="text-xs text-on-surface-variant/60 p-3 bg-surface-container-low rounded-lg text-center">
                Sin imagen asignada
              </div>
            )}
            <input
              id={`prop-image-upload-${element.id}`}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const url = await onImageUpload?.(file);
                  if (url) onUpdate({ imageUrl: url, content: file.name });
                } catch (err: any) {
                  toast.error('Error al subir imagen: ' + err.message);
                }
                e.target.value = '';
              }}
            />
          </div>
      )}

      {/* QR / Signature content */}
      {(element.type === 'qr' || element.type === 'signature') && (
        <div>
          <label className="label">Contenido / Variable</label>
          <input
            className="input text-sm"
            value={element.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            placeholder="{{variable}}"
          />
        </div>
      )}

      <hr className="border-outline-variant/20" />

      {/* Typography (text types) */}
      {(element.type === 'text' || element.type === 'date' || element.type === 'consecutive') && (
        <>
          {/* Font size */}
          <div>
            <label className="label">Tamaño de fuente</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={8}
                max={48}
                value={element.fontSize || 14}
                onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
                className="flex-1 accent-primary h-1.5"
              />
              <span className="text-xs font-semibold text-on-surface w-8 text-right">{element.fontSize || 14}px</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {FONT_SIZES.filter(s => s <= 24 || s % 4 === 0).map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdate({ fontSize: s })}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    (element.fontSize || 14) === s
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Bold / Italic */}
          <div className="flex gap-2">
            <button
              onClick={() => onUpdate({ bold: !element.bold })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                element.bold ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <Bold size={14} /> Negrita
            </button>
            <button
              onClick={() => onUpdate({ italic: !element.italic })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                element.italic ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <Italic size={14} /> Cursiva
            </button>
          </div>

          {/* Alignment */}
          <div>
            <label className="label">Alineación</label>
            <div className="flex gap-1">
              {[
                { value: 'left' as const, icon: AlignLeft },
                { value: 'center' as const, icon: AlignCenter },
                { value: 'right' as const, icon: AlignRight },
                { value: 'justify' as const, icon: AlignJustify },
              ].map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onUpdate({ align: value })}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    (element.align || 'left') === value
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="label">Color de texto</label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onUpdate({ color: c })}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    (element.color || '#191c1e') === c
                      ? 'border-primary scale-110 shadow-md'
                      : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <hr className="border-outline-variant/20" />
        </>
      )}

      {/* Position & Size (all elements) */}
      <div>
        <label className="label flex items-center gap-1">
          <Move size={12} /> Posición
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-on-surface-variant/60">X</span>
            <input
              type="number"
              className="input text-xs py-1.5"
              value={Math.round(element.x)}
              onChange={(e) => onUpdate({ x: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            <span className="text-[10px] text-on-surface-variant/60">Y</span>
            <input
              type="number"
              className="input text-xs py-1.5"
              value={Math.round(element.y)}
              onChange={(e) => onUpdate({ y: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          <Maximize size={12} /> Tamaño
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-on-surface-variant/60">Ancho</span>
            <input
              type="number"
              className="input text-xs py-1.5"
              value={Math.round(element.width)}
              onChange={(e) => onUpdate({ width: parseInt(e.target.value) || 20 })}
              min={20}
            />
          </div>
          <div>
            <span className="text-[10px] text-on-surface-variant/60">Alto</span>
            <input
              type="number"
              className="input text-xs py-1.5"
              value={Math.round(element.height)}
              onChange={(e) => onUpdate({ height: parseInt(e.target.value) || 10 })}
              min={10}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplateEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateId = searchParams.get('id');
  const isEditing = !!templateId;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('certificate');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [pageSize, setPageSize] = useState<'A4' | 'LETTER' | 'LEGAL'>('A4');
  const [activePage, setActivePage] = useState(0);
  const [elements, setElements] = useState<TemplateElement[]>([]);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [dependencyId, setDependencyId] = useState('');
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVariables, setShowVariables] = useState(true);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [customVariables, setCustomVariables] = useState<{ key: string; label: string }[]>([]);
  const [newCustomVarName, setNewCustomVarName] = useState('');
  const [margins, setMargins] = useState({ top: 40, bottom: 40, left: 40, right: 40 });

  // Compute page numbers from elements
  const pageNumbers = [...new Set(elements.map(el => el.page ?? 0))].sort((a, b) => a - b);
  const totalPages = Math.max(pageNumbers.length, 1);
  // Ensure activePage is within range after filtering
  const safeActivePage = Math.min(activePage, Math.max(...pageNumbers, 0));

  const selectedElement = elements.find((el) => el.id === selectedElementId) || null;

  // Load dependencies for the selector
  useEffect(() => {
    loadDependencies();
  }, []);

  const loadDependencies = async () => {
    try {
      const { data } = await supabase
        .from('dependencies')
        .select('id, name, code')
        .order('name');
      setDependencies(data || []);
    } catch (err) {
      console.error('Error loading dependencies:', err);
    }
  };

  useEffect(() => {
    if (templateId) loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('templates').select('*').eq('id', templateId).single();
      if (error) throw error;
      if (data) {
        setName(data.name);
        setCode(data.code);
        setCategory(data.category || 'certificate');
        setOrientation(data.orientation as 'portrait' | 'landscape');
        const config = data.config as any;
        setPageSize((data.page_size as any) || config?.pageSize || 'A4');
        setDependencyId(data.dependency_id || '');
        setElements(config?.elements || []);
        setLogoUrl(config?.logoUrl || '');
        if (config?.margins) {
          setMargins(config.margins);
        }
        // Restore active page from elements
        const pages = new Set(config?.elements?.map((el: any) => el.page ?? 0) || [0]);
        setActivePage(0);
        if (config?.activePage !== undefined) setActivePage(config.activePage);

        // Load custom variables from template (those not in the predefined list)
        const savedVars = Array.isArray(data.variables) ? data.variables : [];
        const predefinedKeys = CERTIFICATE_VARIABLES.map(v => v.key);
        const customKeys = savedVars.filter((v: string) => !predefinedKeys.includes(v));
        if (customKeys.length > 0) {
          setCustomVariables(customKeys.map((key: string) => ({
            key,
            label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          })));
        }
      }
    } catch (err: any) {
      toast.error('Error al cargar plantilla');
      navigate('/templates');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (file: File): Promise<string> => {
    if (!templateId && !code) {
      const tempId = `temp-${Date.now()}`;
      const path = `${STORAGE.PATHS.TEMPLATE_LOGOS(tempId)}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(path, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(path);
      setLogoUrl(publicUrl);
      return publicUrl;
    }

    const id = templateId || `new-${Date.now()}`;
    const path = `${STORAGE.PATHS.TEMPLATE_LOGOS(id)}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE.BUCKET).upload(path, file);
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from(STORAGE.BUCKET).getPublicUrl(path);
    setLogoUrl(publicUrl);
    return publicUrl;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Solo imágenes'); return; }

    try {
      const url = await handleImageUpload(file);
      setLogoUrl(url);
      toast.success('Logo institucional subido');

      const newElement: TemplateElement = {
        id: `el-${Date.now()}`,
        type: 'image',
        x: 50,
        y: 30,
        width: 120,
        height: 80,
        content: file.name,
        imageUrl: url,
      };
      setElements([...elements, newElement]);
    } catch (err: any) {
      toast.error('Error al subir logo: ' + err.message);
    }
  };

  const addVariableToCanvas = (varKey: string, varLabel: string) => {
    const exists = elements.some(el => el.fieldKey === varKey || el.content === `{{${varKey}}}`);
    if (exists) { toast('Este campo ya está en el canvas', { icon: 'ℹ️' }); return; }

    const newElement: TemplateElement = {
      id: `el-${Date.now()}`,
      type: 'text',
      x: 100 + Math.random() * 100,
      y: 200 + Math.random() * 100,
      width: 200,
      height: 36,
      content: `{{${varKey}}}`,
      fontSize: 14,
      align: 'center',
      bold: false,
      color: '#191c1e',
      fieldKey: varKey,
    };
    setElements([...elements, newElement]);
    setSelectedElementId(newElement.id);
    toast.success(`Campo "${varLabel}" agregado al canvas`);
  };

  const addCustomVariable = () => {
    const rawKey = newCustomVarName.trim().toLowerCase().replace(/[^a-z0-9_áéíóúñ]/g, '_').replace(/_+/g, '_');
    if (!rawKey) { toast.error('Ingresa un nombre para el campo'); return; }

    // Check if already exists
    const allKeys = [...CERTIFICATE_VARIABLES.map(v => v.key), ...customVariables.map(v => v.key)];
    if (allKeys.includes(rawKey)) { toast.error('Este campo ya existe'); return; }

    const label = rawKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const newVar = { key: rawKey, label };
    setCustomVariables([...customVariables, newVar]);
    setNewCustomVarName('');
    toast.success(`Campo "${label}" creado`);
  };

  const removeCustomVariable = (key: string) => {
    setCustomVariables(customVariables.filter(v => v.key !== key));
    // Also remove from canvas if present
    setElements(elements.filter(el => el.fieldKey !== key && el.content !== `{{${key}}}`));
  };

  const updateElement = (id: string, updates: Partial<TemplateElement>) => {
    setElements(elements.map(el => (el.id === id ? { ...el, ...updates } : el)));
  };

  const handleSave = async () => {
    if (!name || !code) { toast.error('Nombre y código requeridos'); return; }
    if (!dependencyId) { toast.error('Debes seleccionar una dependencia'); return; }

    setSaving(true);
    try {
      const payload = {
        name,
        code,
        category,
        orientation,
        page_size: pageSize,
        dependency_id: dependencyId,
        config: {
          elements,
          logoUrl,
          margins,
          pageSize,
          orientation,
        },
        variables: [...CERTIFICATE_VARIABLES.map(v => v.key), ...customVariables.map(v => v.key)],
        is_active: true,
      };

      if (isEditing) {
        const { error } = await supabase.from('templates').update(payload).eq('id', templateId);
        if (error) throw error;
        toast.success('Plantilla actualizada');
      } else {
        const { data: inst } = await supabase.from('institutions').select('id').limit(1).single();
        const { error } = await supabase.from('templates').insert({
          ...payload,
          institution_id: inst?.id || null,
        });
        if (error) throw error;
        toast.success('Plantilla creada');
      }
      navigate('/templates');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col animate-fade-in">
      {/* Top bar */}
      <div className="glass-card flex items-center justify-between px-4 py-3 rounded-t-2xl border border-white/40">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/templates')} className="btn-ghost btn-sm">
            <ArrowLeft size={16} />
          </button>
          <span className="text-headline-md font-headline-md text-on-surface">Editor de Plantillas</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary-fixed text-on-primary-fixed uppercase tracking-wider">
            {isEditing ? 'Editando' : 'Nuevo'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input className="input w-36" value={name}
            onChange={e => setName(e.target.value)} placeholder="Nombre" />
          <input className="input w-24" value={code}
            onChange={e => setCode(e.target.value)} placeholder="Código" />
          <select className="input w-28" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="certificate">Certificado</option>
            <option value="diploma">Diploma</option>
            <option value="constancy">Constancia</option>
            <option value="academic">Académico</option>
          </select>
          <select className="input w-28" value={pageSize} onChange={e => setPageSize(e.target.value as any)}>
            <option value="A4">A4</option>
            <option value="LETTER">Carta</option>
            <option value="LEGAL">Oficio</option>
          </select>
          <select className="input w-28" value={orientation} onChange={e => setOrientation(e.target.value as any)}>
            <option value="landscape">Horizontal</option>
            <option value="portrait">Vertical</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          {/* Page navigation */}
          <span className="text-xs text-on-surface-variant/60 mr-1">
            Pág {safeActivePage + 1}/{totalPages}
          </span>
          <button
            onClick={() => setActivePage(p => Math.max(0, p - 1))}
            disabled={safeActivePage <= 0}
            className="btn-ghost btn-xs px-1.5 py-1"
            title="Página anterior"
          >
            ◀
          </button>
          <button
            onClick={() => setActivePage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safeActivePage >= totalPages - 1}
            className="btn-ghost btn-xs px-1.5 py-1"
            title="Siguiente página"
          >
            ▶
          </button>
          <button
            onClick={() => {
              const nextPage = totalPages;
              const currentEls = elements.filter(el => (el.page ?? 0) === safeActivePage);
              // Always create at least one element on the new page to make it visible
              const newElements = [...elements];
              if (currentEls.length > 0) {
                // Copy elements of current page to new page
                const copied = currentEls.map(el => ({
                  ...el,
                  id: `el-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  page: nextPage,
                }));
                setElements([...newElements, ...copied]);
              } else {
                // Add a small spacer element so the page actually exists
                const spacer: TemplateElement = {
                  id: `el-${Date.now()}-spacer`,
                  type: 'text',
                  x: 0, y: 0, width: 1, height: 1,
                  content: '', fontSize: 1,
                  page: nextPage,
                };
                setElements([...newElements, spacer]);
              }
              setActivePage(nextPage);
            }}
            disabled={totalPages >= 20}
            className="btn-ghost btn-xs px-1.5 py-1"
            title="Añadir página"
          >
            + Pág
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm ms-2">
            <Save size={16} /> {saving ? 'Guardando...' : 'Publicar'}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-surface-container-low p-4">
          <TemplateCanvas
            elements={elements}
            onChange={setElements}
            pageOrientation={orientation}
            pageSize={pageSize}
            activePage={activePage}
            onActivePageChange={setActivePage}
            onImageUpload={handleImageUpload}
            onSelectElement={(el) => setSelectedElementId(el?.id || null)}
            selectedElementId={selectedElementId}
            margins={margins}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-80 glass-card border-l border-white/40 p-4 overflow-y-auto space-y-5">
          {/* -- PROPERTIES PANEL (when element selected) -- */}
          {selectedElement ? (
            <PropertiesPanel
              element={selectedElement}
              onUpdate={(updates) => updateElement(selectedElement.id, updates)}
              onDelete={() => {
                setElements(elements.filter(el => el.id !== selectedElement.id));
                setSelectedElementId(null);
              }}
              onImageUpload={handleImageUpload}
            />
          ) : (
            <>
              {/* Logo Upload Section */}
              <div>
                <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ImageIcon size={16} />
                  Logo Institucional
                </h4>
                <div className="flex flex-col gap-2">
                  {logoUrl ? (
                    <div className="relative group">
                      <img src={logoUrl} alt="Logo" className="w-full h-24 object-contain bg-white/50 rounded-xl border border-outline-variant p-2" />
                      <button
                        onClick={() => document.getElementById('logo-upload')?.click()}
                        className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white text-sm font-medium"
                      >
                        Cambiar logo
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl p-6 cursor-pointer hover:border-primary/50 transition-all bg-white/30">
                      <Upload size={24} className="text-on-surface-variant/60 mb-2" />
                      <span className="text-xs font-medium text-on-surface-variant">Subir logo institucional</span>
                      <input id="logo-upload" type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                  )}
                </div>
              </div>

              <hr className="border-outline-variant/30" />

              {/* Dependency Selector */}
              <div>
                <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Layers size={16} />
                  Dependencia
                </h4>
                <select
                  className="input w-full"
                  value={dependencyId}
                  onChange={e => setDependencyId(e.target.value)}
                >
                  <option value="">Seleccionar dependencia...</option>
                  {dependencies.map(d => (
                    <option key={d.id} value={d.id}>{d.name} {d.code ? `(${d.code})` : ''}</option>
                  ))}
                </select>
              </div>

              <hr className="border-outline-variant/30" />

              {/* Margins Configuration */}
              <div>
                <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Move size={16} />
                  Márgenes
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-on-surface-variant/60 block mb-0.5">Superior</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      className="input text-xs py-1.5"
                      value={margins.top}
                      onChange={e => setMargins({ ...margins, top: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-on-surface-variant/60 block mb-0.5">Inferior</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      className="input text-xs py-1.5"
                      value={margins.bottom}
                      onChange={e => setMargins({ ...margins, bottom: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-on-surface-variant/60 block mb-0.5">Izquierdo</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      className="input text-xs py-1.5"
                      value={margins.left}
                      onChange={e => setMargins({ ...margins, left: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-on-surface-variant/60 block mb-0.5">Derecho</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      className="input text-xs py-1.5"
                      value={margins.right}
                      onChange={e => setMargins({ ...margins, right: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-on-surface-variant/40 mt-1 leading-tight">
                  Las guías visuales en el canvas muestran el área segura del documento.
                </p>
              </div>

              <hr className="border-outline-variant/30" />

              {/* Certificate Fields */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                    <List size={16} />
                    Campos del Certificado
                  </h4>
                  <button
                    onClick={() => setShowVariables(!showVariables)}
                    className="text-[11px] text-primary font-semibold hover:underline"
                  >
                    {showVariables ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>

                {showVariables && (
                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                    {/* Custom variables input */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <input
                        className="input text-xs py-1.5 flex-1"
                        placeholder="Nuevo campo personalizado..."
                        value={newCustomVarName}
                        onChange={e => setNewCustomVarName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCustomVariable(); }}
                      />
                      <button
                        onClick={addCustomVariable}
                        disabled={!newCustomVarName.trim()}
                        className="btn-primary btn-xs px-2 py-1.5 text-[10px]"
                      >
                        + Agregar
                      </button>
                    </div>

                    {/* Predefined variables */}
                    {CERTIFICATE_VARIABLES.map(v => {
                      const isOnCanvas = elements.some(el => el.fieldKey === v.key || el.content === `{{${v.key}}}`);
                      return (
                        <button
                          key={v.key}
                          onClick={() => addVariableToCanvas(v.key, v.label)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all text-xs border ${
                            isOnCanvas
                              ? 'bg-primary/5 border-primary/20 text-primary'
                              : 'hover:bg-surface-container-low border-transparent text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                            isOnCanvas ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'
                          }`}>
                            {v.key.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold leading-tight">{v.label}</p>
                            <p className="text-[10px] text-on-surface-variant/60 truncate">{v.desc}</p>
                          </div>
                          {isOnCanvas && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">OK</span>
                          )}
                        </button>
                      );
                    })}

                    {/* Custom variables */}
                    {customVariables.length > 0 && (
                      <>
                        <hr className="border-outline-variant/20 my-2" />
                        <p className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider mb-1">
                          Campos personalizados ({customVariables.length})
                        </p>
                        {customVariables.map(v => {
                          const isOnCanvas = elements.some(el => el.fieldKey === v.key || el.content === `{{${v.key}}}`);
                          return (
                            <div key={v.key} className="flex items-center gap-1">
                              <button
                                onClick={() => addVariableToCanvas(v.key, v.label)}
                                className={`flex-1 flex items-center gap-3 p-2.5 rounded-xl text-left transition-all text-xs border ${
                                  isOnCanvas
                                    ? 'bg-primary/5 border-primary/20 text-primary'
                                    : 'hover:bg-surface-container-low border-transparent text-on-surface-variant hover:text-on-surface'
                                }`}
                              >
                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                                  isOnCanvas ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-on-surface-variant'
                                }`}>
                                  {v.key.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold leading-tight">{v.label}</p>
                                  <p className="text-[10px] text-on-surface-variant/60 truncate">Campo personalizado</p>
                                </div>
                                {isOnCanvas && (
                                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">OK</span>
                                )}
                              </button>
                              <button
                                onClick={() => removeCustomVariable(v.key)}
                                className="p-1.5 hover:bg-error/10 rounded-lg text-on-surface-variant hover:text-error transition-colors shrink-0"
                                title="Eliminar campo"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>

              <hr className="border-outline-variant/30" />

              {/* Element list */}
              <div>
                <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3">
                  Elementos en canvas ({elements.length})
                </h4>
                <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  {elements.map((el, i) => (
                    <button
                      key={el.id}
                      onClick={() => setSelectedElementId(el.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        selectedElementId === el.id
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-surface-container-low text-on-surface-variant'
                      }`}
                      title={el.content}
                    >
                      <span className="text-on-surface-variant/40 w-4 font-mono">{i + 1}</span>
                      <span className="capitalize flex-1 font-medium text-left">{el.type}</span>
                      <span className="truncate max-w-[100px]">{el.content}</span>
                    </button>
                  ))}
                  {elements.length === 0 && (
                    <p className="text-xs text-on-surface-variant/60 text-center py-4">
                      Agrega campos desde la sección "Campos del Certificado"
                    </p>
                  )}
                </div>
              </div>

              <hr className="border-outline-variant/30" />

              {/* JSON preview */}
              <details>
                <summary className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider cursor-pointer hover:text-on-surface flex items-center gap-1">
                  <Code size={14} />
                  Vista JSON
                </summary>
                <pre className="mt-2 p-3 bg-surface-container-low rounded-lg text-[10px] text-on-surface-variant overflow-auto max-h-40 font-mono">
                  {JSON.stringify({ elements, logoUrl, pageSize: 'A4', orientation }, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
