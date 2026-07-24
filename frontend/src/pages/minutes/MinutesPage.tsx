import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  FileText, Plus, Search, X, CheckCircle, Clock, Pen, Trash2,
  User, Users, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { SkeletonCard } from '../../components/ui/SkeletonCard';

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  DRAFT: { label: 'Borrador', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: FileText },
  PENDING: { label: 'Pendiente', color: 'bg-blue-100 text-blue-600 border-blue-200', icon: Clock },
  COMPLETED: { label: 'Completada', color: 'bg-emerald-100 text-emerald-600 border-emerald-200', icon: CheckCircle },
  CANCELLED: { label: 'Cancelada', color: 'bg-rose-100 text-rose-600 border-rose-200', icon: AlertTriangle },
};

const MINUTE_VARIABLES_MAP: Record<string, { label: string; type: string }> = {
  codigo_acta: { label: 'Código del Acta', type: 'text' },
  asunto: { label: 'Asunto', type: 'text' },
  fecha_acta: { label: 'Fecha del Acta', type: 'date' },
  lugar: { label: 'Lugar', type: 'text' },
  hora_inicio: { label: 'Hora de Inicio', type: 'text' },
  hora_fin: { label: 'Hora de Finalización', type: 'text' },
  detalle: { label: 'Detalle / Desarrollo', type: 'textarea' },
  acuerdos: { label: 'Acuerdos', type: 'textarea' },
  nombre_firmante: { label: 'Nombre del Firmante', type: 'text' },
  cargo_firmante: { label: 'Cargo del Firmante', type: 'text' },
};

export function MinutesPage() {
  const { user } = useAuth();
  const [minutes, setMinutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<any>(null);

  // Templates
  const [minuteTemplates, setMinuteTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedTemplateFields, setSelectedTemplateFields] = useState<any[]>([]);
  const [templateFieldValues, setTemplateFieldValues] = useState<Record<string, string>>({});

  // Create form
  const [form, setForm] = useState({
    title: '',
    description: '',
    contentFields: [] as { key: string; value: string }[],
    recipients: [] as { full_name: string; email: string }[],
    requireAll: true,
  });
  const [saving, setSaving] = useState(false);

  // Detail state
  const [detailRecipients, setDetailRecipients] = useState<any[]>([]);
  const [detailSignatures, setDetailSignatures] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { loadMinutes(); }, [user?.id, user?.role]);

  const loadMinutes = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('minutes')
        .select('*, creator:users!minutes_created_by_fkey(first_name, last_name)')
        .order('created_at', { ascending: false });

      // APPLICANT sees only their own
      if (user?.role === 'APPLICANT') {
        query = query.eq('created_by', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setMinutes(data || []);
    } catch (err: any) {
      console.error('Error loading minutes:', err);
      toast.error('Error al cargar actas');
    } finally {
      setLoading(false);
    }
  };

  // ── Create ──
  const openCreate = async () => {
    setForm({
      title: '',
      description: '',
      contentFields: [{ key: '', value: '' }],
      recipients: [],
      requireAll: true,
    });
    setSelectedTemplateId('');
    setSelectedTemplateFields([]);
    setTemplateFieldValues({});
    setShowCreate(true);

    // Load minute templates
    try {
      let query = supabase
        .from('templates')
        .select('id, name, code, config')
        .eq('category', 'minute')
        .eq('is_active', true);
      if (user?.dependency_id) {
        query = query.or(`dependency_id.eq.${user.dependency_id},dependency_id.is.null`);
      }
      const { data } = await query.order('name');
      setMinuteTemplates(data || []);
    } catch { /* ignore */ }
  };

  const MINUTE_VARIABLES_MAP: Record<string, { label: string; type: string }> = {
    codigo_acta: { label: 'Código del Acta', type: 'text' },
    asunto: { label: 'Asunto', type: 'text' },
    fecha_acta: { label: 'Fecha del Acta', type: 'date' },
    lugar: { label: 'Lugar', type: 'text' },
    hora_inicio: { label: 'Hora de Inicio', type: 'text' },
    hora_fin: { label: 'Hora de Finalización', type: 'text' },
    detalle: { label: 'Detalle / Desarrollo', type: 'textarea' },
    acuerdos: { label: 'Acuerdos', type: 'textarea' },
    nombre_firmante: { label: 'Nombre del Firmante', type: 'text' },
    cargo_firmante: { label: 'Cargo del Firmante', type: 'text' },
  };

  const extractTemplateVariables = (template: any): string[] => {
    const vars = new Set<string>();
    if (template?.config?.elements && Array.isArray(template.config.elements)) {
      template.config.elements.forEach((el: any) => {
        if (typeof el.content === 'string') {
          // Create fresh regex per element to avoid statefulness issues with global regex
          const matches = el.content.matchAll(/{\{\s*([^}\s]+)\s*}}/g);
          for (const match of matches) {
            vars.add(match[1]);
          }
        }
      });
    }
    // Also use template's variables array if available
    if (template?.variables && Array.isArray(template.variables)) {
      template.variables.forEach((v: string) => vars.add(v));
    }
    return Array.from(vars);
  };

  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    setTemplateFieldValues({});

    if (!templateId) {
      setSelectedTemplateFields([]);
      return;
    }

    // Load full template data including elements config
    try {
      const { data: tmpl } = await supabase
        .from('templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (tmpl) {
        const vars = extractTemplateVariables(tmpl);
        const fields = vars.map(key => {
          const known = MINUTE_VARIABLES_MAP[key];
          return {
            key,
            label: known?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            type: known?.type || 'text',
            required: false,
          };
        });
        setSelectedTemplateFields(fields);
        const initial: Record<string, string> = {};
        fields.forEach((f: any) => { initial[f.key] = ''; });
        setTemplateFieldValues(initial);
        setForm(prev => ({ ...prev, title: tmpl.name || prev.title }));
      } else {
        setSelectedTemplateFields([]);
      }
    } catch {
      setSelectedTemplateFields([]);
    }
  };

  const addRecipient = () => {
    setForm({ ...form, recipients: [...form.recipients, { full_name: '', email: '' }] });
  };

  const removeRecipient = (idx: number) => {
    setForm({ ...form, recipients: form.recipients.filter((_, i) => i !== idx) });
  };

  const updateRecipient = (idx: number, field: 'full_name' | 'email', value: string) => {
    const updated = [...form.recipients];
    updated[idx] = { ...updated[idx], [field]: value };
    setForm({ ...form, recipients: updated });
  };

  const addContentField = () => {
    setForm({ ...form, contentFields: [...form.contentFields, { key: '', value: '' }] });
  };

  const removeContentField = (idx: number) => {
    setForm({ ...form, contentFields: form.contentFields.filter((_, i) => i !== idx) });
  };

  const updateContentField = (idx: number, field: 'key' | 'value', val: string) => {
    const updated = [...form.contentFields];
    updated[idx] = { ...updated[idx], [field]: val };
    setForm({ ...form, contentFields: updated });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error('El título es obligatorio');
      return;
    }
    const validRecipients = form.recipients.filter(r => r.full_name.trim() && r.email.trim());
    if (validRecipients.length === 0) {
      toast.error('Agrega al menos un destinatario válido');
      return;
    }

    // Build content JSON from fields (template fields take precedence if template selected)
    const content: Record<string, string> = {};
    if (selectedTemplateId && selectedTemplateFields.length > 0) {
      Object.entries(templateFieldValues).forEach(([key, value]) => {
        if (value.trim()) content[key] = value;
      });
    } else {
      form.contentFields
        .filter(f => f.key.trim())
        .forEach(f => { content[f.key.trim()] = f.value; });
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_minute', {
        p_title: form.title.trim(),
        p_description: form.description.trim() || null,
        p_content: content,
        p_recipients: validRecipients.map(r => ({ full_name: r.full_name.trim(), email: r.email.trim() })),
        p_require_all: form.requireAll,
        p_institution_id: user?.institution_id || null,
        p_template_id: selectedTemplateId || null,
        p_expires_at: null,
      });

      if (error) throw error;

      toast.success(`Acta ${data?.code || ''} creada con ${validRecipients.length} destinatario(s)`);
      setShowCreate(false);
      loadMinutes();
    } catch (err: any) {
      toast.error(err.message || 'Error al crear el acta');
    } finally {
      setSaving(false);
    }
  };

  // ── Detail ──
  const openDetail = async (m: any) => {
    setShowDetail(m);
    setDetailRecipients([]);
    setDetailSignatures([]);
    setDetailLoading(true);

    try {
      const [recipientsRes, signaturesRes] = await Promise.all([
        supabase
          .from('minute_recipients')
          .select('*')
          .eq('minute_id', m.id)
          .order('created_at'),
        supabase
          .from('minute_signatures')
          .select('*, recipient:minute_recipients!minute_signatures_recipient_id_fkey(full_name, email)')
          .eq('minute_id', m.id)
          .order('signed_at'),
      ]);

      if (recipientsRes.error) throw recipientsRes.error;
      if (signaturesRes.error) throw signaturesRes.error;

      setDetailRecipients(recipientsRes.data || []);
      setDetailSignatures(signaturesRes.data || []);
    } catch (err: any) {
      console.error('Error loading detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };



  // ── Copy sign link ──
  const copySignLink = (token: string) => {
    const link = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success('Link de firma copiado al portapapeles');
    }).catch(() => {
      toast.error('No se pudo copiar el link');
    });
  };

  // ── Filters ──
  const filtered = minutes.filter(m => {
    const matchesSearch = !search ||
      m.title?.toLowerCase().includes(search.toLowerCase()) ||
      m.code?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatus = (status: string) => statusConfig[status] || statusConfig.DRAFT;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
            <FileText size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-headline-lg font-headline-lg text-on-surface">Actas</h1>
            <p className="text-body-md text-on-surface-variant">Gestión de actas con firma múltiple</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
            <input type="text" placeholder="Buscar..." className="input pl-10 w-48"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={openCreate} className="btn-primary btn-sm">
            <Plus size={16} /> Nueva acta
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {['', 'DRAFT', 'PENDING', 'COMPLETED', 'CANCELLED'].map(s => {
          const cfg = s ? getStatus(s) : { label: 'Todas', color: '' };
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                statusFilter === s
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {s ? cfg.label : 'Todas'}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <SkeletonCard variant="card-sm" count={3} />
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <FileText size={48} className="mx-auto text-surface-variant mb-4" />
            <p className="text-headline-md font-headline-md text-on-surface-variant mb-1">No hay actas</p>
            <p className="text-body-md text-on-surface-variant/60">Crea un acta para comenzar a gestionar firmas</p>
            <button onClick={openCreate} className="btn-primary mt-6">
              <Plus size={16} /> Crear acta
            </button>
          </div>
        ) : filtered.map((m) => {
          const cfg = getStatus(m.status);
          const progress = m.recipient_count > 0
            ? Math.round((m.signed_count / m.recipient_count) * 100)
            : 0;

          return (
            <div
              key={m.id}
              className="glass-card p-5 rounded-2xl hover:shadow-lg transition-all group border border-white/40 cursor-pointer"
              onClick={() => openDetail(m)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                  <FileText size={20} className="text-primary" />
                </div>
                <span className={`text-[11px] font-bold px-3 py-1 rounded-full border ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>

              <h3 className="font-semibold text-on-surface mb-0.5 line-clamp-1">{m.title}</h3>
              <p className="text-xs text-on-surface-variant/70 font-mono mb-2">{m.code}</p>
              {m.description && (
                <p className="text-xs text-on-surface-variant/60 mb-3 line-clamp-2">{m.description}</p>
              )}

              {/* Progress bar */}
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant/60">
                    {m.signed_count}/{m.recipient_count} firmas
                  </span>
                  <span className="font-semibold text-on-surface-variant">{progress}%</span>
                </div>
                <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      m.status === 'COMPLETED'
                        ? 'bg-emerald-500'
                        : m.status === 'CANCELLED'
                          ? 'bg-rose-400'
                          : 'bg-primary'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-outline-variant/20">
                <div className="flex items-center gap-1.5 text-xs text-on-surface-variant/60">
                  <User size={12} />
                  <span className="truncate max-w-[100px]">
                    {m.creator?.first_name} {m.creator?.last_name}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant/40">
                  {format(new Date(m.created_at), 'dd MMM', { locale: es })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── CREATE MODAL ── */}
      {showCreate && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center md:p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-2xl max-h-[95vh] md:max-h-[85vh] animate-slide-up md:animate-scale-in border border-white/40 overflow-hidden">
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h3 className="text-lg font-bold text-on-surface">Nueva acta</h3>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                <X size={18} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(85vh-6rem)]">
              {/* Template selector */}
              <div>
                <label className="label">Plantilla de acta (opcional)</label>
                <select
                  className="input w-full"
                  value={selectedTemplateId}
                  onChange={e => handleTemplateSelect(e.target.value)}
                >
                  <option value="">Sin plantilla — campos manuales</option>
                  {minuteTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} {t.code ? `(${t.code})` : ''}</option>
                  ))}
                </select>
                {minuteTemplates.length === 0 && (
                  <p className="text-xs text-on-surface-variant/60 mt-1">
                    No hay plantillas de acta disponibles. Crea una desde Plantillas &gt; Acta.
                  </p>
                )}
              </div>

              {/* Title & Description */}
              <div>
                <label className="label">Título *</label>
                <input className="input w-full" value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="Ej: Acta de grado 2026" />
              </div>
              <div>
                <label className="label">Descripción</label>
                <textarea className="input w-full min-h-[60px]" value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Descripción opcional del acta" />
              </div>

              {/* Dynamic fields from template */}
              {selectedTemplateFields.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">Contenido del acta</label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedTemplateFields.map((field: any) => (
                      <div key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-on-surface mb-1">
                          {field.label || field.key}
                          {field.required && <span className="text-error ml-0.5">*</span>}
                        </label>
                        {field.type === 'textarea' ? (
                          <textarea
                            className="input w-full min-h-[80px] text-sm"
                            placeholder={field.placeholder || `Ingresa ${field.label || field.key}`}
                            value={templateFieldValues[field.key] || ''}
                            onChange={e => setTemplateFieldValues({ ...templateFieldValues, [field.key]: e.target.value })}
                          />
                        ) : field.type === 'date' ? (
                          <input
                            type="date"
                            className="input w-full text-sm"
                            value={templateFieldValues[field.key] || ''}
                            onChange={e => setTemplateFieldValues({ ...templateFieldValues, [field.key]: e.target.value })}
                          />
                        ) : field.type === 'number' ? (
                          <input
                            type="number"
                            className="input w-full text-sm"
                            placeholder={field.placeholder || '0'}
                            value={templateFieldValues[field.key] || ''}
                            onChange={e => setTemplateFieldValues({ ...templateFieldValues, [field.key]: e.target.value })}
                          />
                        ) : (
                          <input
                            className="input w-full text-sm"
                            placeholder={field.placeholder || `Ingresa ${field.label || field.key}`}
                            value={templateFieldValues[field.key] || ''}
                            onChange={e => setTemplateFieldValues({ ...templateFieldValues, [field.key]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Live preview */}
                  {Object.values(templateFieldValues).some(v => v.trim()) && (
                    <div className="mt-4 bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                      <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">
                        <FileText size={12} className="inline mr-1" />
                        Vista previa del acta
                      </h4>
                      <div className="prose prose-sm max-w-none">
                        {selectedTemplateFields
                          .filter((f: any) => templateFieldValues[f.key]?.trim())
                          .map((field: any) => (
                            <div key={field.key} className="mb-2 pb-2 border-b border-outline-variant/10 last:border-b-0">
                              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold block">
                                {field.label || field.key}
                              </span>
                              <p className="text-sm text-on-surface mt-0.5">
                                {field.type === 'textarea'
                                  ? templateFieldValues[field.key]?.split('\n').map((line: string, i: number) => (
                                      <span key={i}>{line}<br /></span>
                                    ))
                                  : templateFieldValues[field.key]}
                              </p>
                            </div>
                          ))}
                      </div>
                      <div className="mt-3 pt-3 border-t border-outline-variant/10 flex items-center gap-2 text-xs text-on-surface-variant/60">
                        <Pen size={12} />
                        <span>Espacio para firmas</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Manual content fields (when no template selected) */}
              {selectedTemplateFields.length === 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">Campos personalizados</label>
                    <button onClick={addContentField} className="text-xs text-primary font-semibold hover:underline">
                      + Agregar campo
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.contentFields.map((field, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <input
                          className="input flex-1 text-sm"
                          placeholder="Clave (ej: Asunto)"
                          value={field.key}
                          onChange={e => updateContentField(idx, 'key', e.target.value)}
                        />
                        <input
                          className="input flex-[2] text-sm"
                          placeholder="Valor"
                          value={field.value}
                          onChange={e => updateContentField(idx, 'value', e.target.value)}
                        />
                        <button
                          onClick={() => removeContentField(idx)}
                          className="p-2 text-rose-400 hover:text-rose-600 transition-colors shrink-0"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recipients */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Destinatarios *</label>
                  <button onClick={addRecipient} className="text-xs text-primary font-semibold hover:underline">
                    + Agregar destinatario
                  </button>
                </div>
                <div className="space-y-2">
                  {form.recipients.map((r, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-surface-container-low rounded-xl p-3 border border-outline-variant/20">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <User size={14} className="text-primary" />
                      </div>
                      <input
                        className="input flex-1 text-sm"
                        placeholder="Nombre completo"
                        value={r.full_name}
                        onChange={e => updateRecipient(idx, 'full_name', e.target.value)}
                      />
                      <input
                        className="input flex-1 text-sm"
                        placeholder="Correo electrónico"
                        type="email"
                        value={r.email}
                        onChange={e => updateRecipient(idx, 'email', e.target.value)}
                      />
                      <button
                        onClick={() => removeRecipient(idx)}
                        className="p-2 text-rose-400 hover:text-rose-600 transition-colors shrink-0"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {form.recipients.length === 0 && (
                    <p className="text-xs text-on-surface-variant/60 text-center py-4">
                      No hay destinatarios. Agrega al menos uno para continuar.
                    </p>
                  )}
                </div>
              </div>

              {/* Settings */}
              <div className="flex items-center gap-3 bg-surface-container-low rounded-xl px-4 py-3">
                <input
                  type="checkbox"
                  id="requireAll"
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                  checked={form.requireAll}
                  onChange={e => setForm({ ...form, requireAll: e.target.checked })}
                />
                <label htmlFor="requireAll" className="text-sm font-medium text-on-surface cursor-pointer">
                  Requerir firma de todos los destinatarios
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
              <button onClick={() => setShowCreate(false)} className="btn-secondary btn-sm">Cancelar</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary btn-sm">
                {saving ? 'Creando...' : 'Crear acta'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── DETAIL MODAL ── */}
      {showDetail && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center md:p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowDetail(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl shadow-2xl w-full md:max-w-3xl max-h-[95vh] md:max-h-[85vh] animate-slide-up md:animate-scale-in border border-white/40 overflow-hidden">
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-on-surface">{showDetail.title}</h3>
                <span className={`text-[11px] font-bold px-3 py-1 rounded-full border ${getStatus(showDetail.status).color}`}>
                  {getStatus(showDetail.status).label}
                </span>
              </div>
              <button onClick={() => setShowDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                <X size={18} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(85vh-6rem)]">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Código</span>
                  <p className="font-mono font-semibold text-on-surface mt-0.5">{showDetail.code}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Creado</span>
                  <p className="font-semibold text-on-surface mt-0.5">
                    {format(new Date(showDetail.created_at), "dd 'de' MMMM 'de' yyyy", { locale: es })}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Firmas</span>
                  <p className="font-semibold text-on-surface mt-0.5">
                    {showDetail.signed_count} / {showDetail.recipient_count}
                    {showDetail.require_all ? ' (requiere todas)' : ' (una basta)'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Creador</span>
                  <p className="font-semibold text-on-surface mt-0.5">
                    {showDetail.creator?.first_name} {showDetail.creator?.last_name}
                  </p>
                </div>
              </div>

              {/* Description */}
              {showDetail.description && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Descripción</span>
                  <p className="text-sm text-on-surface mt-1">{showDetail.description}</p>
                </div>
              )}

              {/* Content */}
              {showDetail.content && typeof showDetail.content === 'object' && Object.keys(showDetail.content).length > 0 && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Contenido</span>
                  <div className="mt-2 space-y-2">
                    {Object.entries(showDetail.content).map(([key, value]) => (
                      <div key={key} className="bg-surface-container-low rounded-xl px-4 py-3">
                        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">{key}</span>
                        <p className="text-sm text-on-surface mt-0.5">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recipients list */}
              <div>
                <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Users size={14} /> Destinatarios ({detailRecipients.length})
                </h4>
                {detailLoading ? (
                  <SkeletonCard variant="card-sm" count={2} />
                ) : (
                  <div className="space-y-2">
                    {detailRecipients.map((r) => {
                      const recipientSig = detailSignatures.find(s => s.recipient_id === r.id);
                      return (
                        <div key={r.id} className="flex items-center gap-3 bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            r.status === 'SIGNED'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                              : r.status === 'EXPIRED'
                                ? 'bg-rose-50 text-rose-500 border border-rose-200'
                                : 'bg-slate-50 text-slate-400 border border-slate-200'
                          }`}>
                            {r.status === 'SIGNED' ? <CheckCircle size={20} /> : <User size={20} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-on-surface">{r.full_name}</p>
                            <p className="text-xs text-on-surface-variant">{r.email}</p>
                            {r.status === 'SIGNED' && recipientSig && (
                              <p className="text-xs text-emerald-600 mt-0.5">
                                Firmado {format(new Date(recipientSig.signed_at), "dd MMM yyyy HH:mm", { locale: es })}
                              </p>
                            )}
                            {r.status === 'PENDING' && r.invitation_viewed_at && (
                              <p className="text-xs text-blue-600 mt-0.5">Enlace abierto</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                              r.status === 'SIGNED'
                                ? 'bg-emerald-50 text-emerald-600'
                                : r.status === 'EXPIRED'
                                  ? 'bg-rose-50 text-rose-500'
                                  : r.status === 'DECLINED'
                                    ? 'bg-amber-50 text-amber-600'
                                    : 'bg-slate-50 text-slate-500'
                            }`}>
                              {r.status === 'SIGNED' ? 'Firmado'
                                : r.status === 'PENDING' ? 'Pendiente'
                                : r.status === 'EXPIRED' ? 'Expirado'
                                : r.status === 'DECLINED' ? 'Declinado'
                                : r.status}
                            </span>
                            {r.status === 'PENDING' && (
                              <button
                                onClick={() => copySignLink(r.token)}
                                className="p-2 text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                title="Copiar link de firma"
                              >
                                <Link2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Signatures gallery */}
              {detailSignatures.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Pen size={14} /> Firmas registradas
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detailSignatures.map((s) => (
                      <div key={s.id} className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/20">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                            <Pen size={14} className="text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">{s.recipient?.full_name}</p>
                            <p className="text-[10px] text-on-surface-variant">
                              {format(new Date(s.signed_at), "dd MMM yyyy HH:mm", { locale: es })}
                            </p>
                          </div>
                        </div>
                        {s.signature_image_url && (
                          <div
                            className="max-h-16 min-h-[3rem] bg-white bg-no-repeat bg-contain bg-center rounded-lg p-2 border border-outline-variant/20"
                            style={{
                              backgroundImage: `url("${s.signature_image_url}")`,
                              pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                              userSelect: 'none' as React.CSSProperties['userSelect'],
                            }}
                            onContextMenu={e => e.preventDefault()}
                            draggable={false}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress bar */}
              {showDetail.status === 'PENDING' && (
                <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-blue-800">Progreso de firmas</h4>
                    <span className="text-sm font-bold text-blue-700">
                      {showDetail.signed_count}/{showDetail.recipient_count}
                    </span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${showDetail.recipient_count > 0
                          ? (showDetail.signed_count / showDetail.recipient_count) * 100
                          : 0}%`
                      }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-2">
                    {showDetail.signed_count === 0
                      ? 'Nadie ha firmado aún. Copia los links de firma y compártelos.'
                      : showDetail.signed_count < showDetail.recipient_count
                        ? `${showDetail.recipient_count - showDetail.signed_count} destinatario(s) pendiente(s)`
                        : '¡Todas las firmas han sido recopiladas!'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
              <button onClick={() => setShowDetail(null)} className="btn-secondary btn-sm">Cerrar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Helper component for the Link2 icon (not included in lucide-react by default in this project)
function Link2({ size }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
