import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  ArrowLeft, Save, FileText, Upload, Table, AlertCircle, CheckCircle, Download,
  ChevronRight, FileUp, CheckCircle2, Search
} from 'lucide-react';
import { requestsApi, auditApi, getClientIP } from '../../services/api';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { SkeletonCard } from '../../components/ui/SkeletonCard';
import { TemplateThumb } from '../../components/editor/TemplateThumb';
import { getPageSizeLabel, normalizePageSize } from '../../lib/pageSizes';

export const SYSTEM_VARS = new Set(['codigo', 'codigo_certificado', 'radicado', 'consecutivo']);

type CreationType = 'single' | 'multiple';
type StepView = 'TYPE_SELECTION' | 'TEMPLATE_SELECTION' | 'ACTION_AREA';

export const extractTemplateVariables = (template: any): string[] => {
  if (template?.config && Array.isArray(template.config.elements)) {
    const regex = /{{\s*([^}\s]+)\s*}}/g;
    const vars = new Set<string>();
    template.config.elements.forEach((el: any) => {
      if (typeof el.content === 'string') {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(el.content)) !== null) vars.add(match[1]);
      }
    });
    if (vars.size > 0) return Array.from(vars);
  }
  if (template?.variables && Array.isArray(template.variables)) return template.variables;
  return [];
};

export function CreateRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const reuseId = searchParams.get('reuse');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditMode = Boolean(editId);
  const isAdminEdit = isEditMode && user?.role === 'ADMIN';
  const isReuseMode = Boolean(reuseId && !editId);

  // Step view state with transition tracking
  const [currentView, setCurrentView] = useState<StepView>('TYPE_SELECTION');
  const [viewTransition, setViewTransition] = useState<'entering' | 'leaving' | 'idle'>('idle');
  const [requestType, setRequestType] = useState<CreationType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);

  // Templates from database
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Template picker
  const [templateSearch, setTemplateSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Template variables & form
  const [filteredVars, setFilteredVars] = useState<string[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [savingIndividual, setSavingIndividual] = useState(false);

  // Edit mode
  const [originalRequestId, setOriginalRequestId] = useState<string | null>(null);
  const [originalBatchId, setOriginalBatchId] = useState<string | null>(null);
  const [originalRejectedId, setOriginalRejectedId] = useState<string | null>(null);
  const [originalRejectionReason, setOriginalRejectionReason] = useState<string | null>(null);
  // Corrección hecha por un administrador: se devuelve al firmante para nueva validación
  const [originalData, setOriginalData] = useState<Record<string, string>>({});
  const [originalStatus, setOriginalStatus] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');

  // Massive import
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  // ── Load templates ──
  useEffect(() => { if (user) loadTemplates(); }, [user]);
  // Esperar a que carguen las plantillas: antes la solicitud se leía en paralelo,
  // `templates` seguía vacío y el formulario quedaba sin plantilla hasta recargar.
  useEffect(() => { if (reuseId && user && !editId && !loadingTemplates) loadRejectedData(); }, [reuseId, user, editId, loadingTemplates]);
  useEffect(() => { if (editId && user && !loadingTemplates) loadExistingRequest(); }, [editId, user, loadingTemplates]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      let query = supabase.from('templates').select('id, name, code, description, variables, category, config').eq('is_active', true);
      if (user?.role !== 'ADMIN' && user?.permissions?.allowed_template_ids && user.permissions.allowed_template_ids.length > 0) {
        query = query.in('id', user.permissions.allowed_template_ids);
      } else if (user?.dependency_id) {
        query = query.eq('dependency_id', user.dependency_id);
      } else if (user?.institution_id && user?.role !== 'ADMIN') {
        query = query.eq('institution_id', user.institution_id);
      }
      const { data } = await query.order('name');
      setTemplates(data || []);
    } catch (err) { console.error('Error loading templates:', err); }
    finally { setLoadingTemplates(false); }
  };

  /** Plantilla por id: la lista cargada puede no incluirla (permisos, inactiva). */
  const resolveTemplate = async (templateId: string) => {
    const found = templates.find(t => t.id === templateId);
    if (found) return found;
    const { data } = await supabase
      .from('templates')
      .select('id, name, code, description, variables, category, config')
      .eq('id', templateId)
      .maybeSingle();
    return data || null;
  };

  const loadRejectedData = async () => {
    try {
      const { data, error } = await supabase.from('certificate_requests').select('*, template:templates(name)').eq('id', reuseId).single();
      if (error) throw error;
      if (!data) { toast.error('Solicitud no encontrada'); navigate('/requests'); return; }
      if (data.user_id !== user?.id) { toast.error('No tienes permiso'); navigate('/requests'); return; }
      setOriginalRejectedId(reuseId);
      setOriginalRejectionReason(data.rejection_reason);
      if (data.data && typeof data.data === 'object') setFormData(data.data as Record<string, string>);
      const template = await resolveTemplate(data.template_id);
      if (template) { setSelectedTemplate(template); handleTemplateSelect(template, false); }
      setCurrentView('ACTION_AREA');
      setRequestType(data.type === 'MASSIVE' || data.batch_id ? 'multiple' : 'single');
    } catch (err: any) { toast.error('Error al cargar datos'); navigate('/requests'); }
  };

  const loadExistingRequest = async () => {
    try {
      const { data, error } = await supabase.from('certificate_requests').select('*').eq('id', editId).single();
      if (error) throw error;
      if (!data) { toast.error('Solicitud no encontrada'); navigate('/requests'); return; }
      const isAdmin = user?.role === 'ADMIN';
      if (!isAdmin && data.user_id !== user?.id) { toast.error('No tienes permiso'); navigate('/requests'); return; }
      const editableStatuses = isAdmin ? ['DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED', 'APPROVED'] : ['DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED'];
      if (!editableStatuses.includes(data.status)) { toast.error(data.status === 'SIGNED' ? 'Un documento firmado digitalmente no puede editarse; revócalo y crea uno nuevo.' : 'No puede editarse'); navigate('/requests'); return; }
      // El administrador corrige una solicitud a la vez, aunque pertenezca a un lote
      setRequestType(!isAdmin && (data.type === 'MASSIVE' || data.batch_id) ? 'multiple' : 'single');
      setOriginalStatus(data.status);
      setOriginalData((data.data && typeof data.data === 'object' ? data.data : {}) as Record<string, string>);
      const template = await resolveTemplate(data.template_id);
      if (template) { setSelectedTemplate(template); handleTemplateSelect(template, false); }
      if (data.data && typeof data.data === 'object') setFormData(data.data as Record<string, string>);
      setOriginalRequestId(editId!);
      if (data.batch_id) setOriginalBatchId(data.batch_id);
      // Admin: la plantilla no se cambia, se salta directo al formulario
      setCurrentView('ACTION_AREA');
    } catch (err: any) { toast.error('Error al cargar solicitud'); navigate('/requests'); }
  };

  const categories = useMemo(
    () => [...new Set(templates.map(t => t.category).filter(Boolean))] as string[],
    [templates],
  );
  const visibleTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    return templates.filter(t =>
      (categoryFilter === 'all' || t.category === categoryFilter) &&
      (!q || [t.name, t.code, t.description, t.category].some((v: string) => v?.toLowerCase().includes(q))));
  }, [templates, templateSearch, categoryFilter]);

  // ── Navigation with transitions ──
  const navigateToView = (view: StepView) => {
    setViewTransition('leaving');
    setTimeout(() => {
      setCurrentView(view);
      setViewTransition('entering');
      setTimeout(() => setViewTransition('idle'), 300);
    }, 200);
  };

  const handleBack = () => {
    if (currentView === 'ACTION_AREA') navigateToView('TEMPLATE_SELECTION');
    else if (currentView === 'TEMPLATE_SELECTION') { setRequestType(null); setSelectedTemplate(null); navigateToView('TYPE_SELECTION'); }
  };

  const handleTypeSelect = (type: CreationType) => {
    setRequestType(type);
    navigateToView('TEMPLATE_SELECTION');
  };

  const handleTemplateSelect = (template: any, resetForm = true) => {
    setSelectedTemplate(template);
    const vars = extractTemplateVariables(template);
    const visible = vars.filter((v: string) => !SYSTEM_VARS.has(v));
    setFilteredVars(visible);
    if (resetForm) {
      const initial: Record<string, string> = {};
      visible.forEach((v: string) => { initial[v] = ''; });
      setFormData(initial);
      setExcelData([]); setExcelColumns([]); setColumnMapping({});
    }
  };

  const handleContinueToForm = () => {
    if (!selectedTemplate) return;
    navigateToView('ACTION_AREA');
  };

  // ── Submit ──
  const handleIndividualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) { toast.error('Selecciona una plantilla'); return; }
    setSavingIndividual(true);
    try {
      const missing = filteredVars.filter(v => !formData[v]?.toString().trim());
      if (missing.length > 0) {
        toast.error(`Falta completar: ${missing.slice(0, 3).map(v => v.replace(/_/g, ' ')).join(', ')}${missing.length > 3 ? ` y ${missing.length - 3} más` : ''}`);
        setSavingIndividual(false);
        return;
      }
      const dataToSend = Object.fromEntries(Object.entries(formData).filter(([, v]) => v !== ''));
      if (isAdminEdit && originalRequestId) {
        if (!correctionReason.trim()) { toast.error('Indica qué se corrigió para que el firmante lo sepa'); setSavingIndividual(false); return; }
        const changed = Object.keys({ ...originalData, ...dataToSend })
          .filter(k => String(originalData[k] ?? '') !== String(dataToSend[k] ?? ''));
        if (changed.length === 0) { toast('No hay cambios que guardar', { icon: 'ℹ️' }); setSavingIndividual(false); return; }
        // Vuelve a PENDING: el firmante debe validar de nuevo. Se limpian la firma y el PDF anteriores.
        await requestsApi.update(originalRequestId, {
          data: dataToSend,
          status: 'PENDING',
          rejection_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          reviewer_notes: null,
          certificate_url: null,
        });
        try {
          const ip = await getClientIP();
          await auditApi.log({
            user_id: user?.id, user_email: user?.email, module: 'requests', action: 'correct',
            entity_id: originalRequestId, entity_type: 'certificate_request', ip_address: ip,
            old_values: Object.fromEntries(changed.map(k => [k, originalData[k] ?? null])),
            new_values: Object.fromEntries(changed.map(k => [k, dataToSend[k] ?? null])),
            description: `Corrección del administrador (estado anterior ${originalStatus}): ${correctionReason.trim()}`,
          });
        } catch {}
        toast.success('Corrección guardada; la solicitud volvió al firmante para validación');
      } else if (isEditMode && originalRequestId) {
        await requestsApi.update(originalRequestId, { template_id: selectedTemplate.id, data: dataToSend });
        try { const ip = await getClientIP(); await auditApi.log({ user_id: user?.id, user_email: user?.email, module: 'requests', action: 'update', entity_id: originalRequestId, entity_type: 'certificate_request', ip_address: ip, description: 'Solicitud editada' }); } catch {}
        toast.success('Solicitud actualizada');
      } else {
        const code = `REQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await requestsApi.create({ code, type: 'INDIVIDUAL', status: 'PENDING', user_id: user?.id, template_id: selectedTemplate.id, data: dataToSend });
        toast.success('Solicitud creada exitosamente');
      }
      navigate('/requests');
    } catch (err: any) { toast.error(err.message || 'Error al guardar'); }
    finally { setSavingIndividual(false); }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = (XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' }) as any[][])
          .filter(r => r.some(c => String(c).trim() !== ''));
        if (rows.length === 0) { toast.error('Archivo vacío'); return; }

        // Si la primera fila trae una cédula (6+ dígitos) no son encabezados sino el primer
        // estudiante: antes se usaba como nombres de columna y esa persona se perdía.
        const first = rows[0].map(c => String(c).trim());
        const noHeaders = first.some(c => /^\d{6,}$/.test(c));
        const seen = new Map<string, number>();
        const columns = first.map((c, i) => {
          const base = noHeaders || !c ? `Columna ${i + 1}` : c;
          const n = (seen.get(base) || 0) + 1;
          seen.set(base, n);
          return n > 1 ? `${base} (${n})` : base;
        });
        const body = noHeaders ? rows : rows.slice(1);
        const json: Record<string, string>[] = body.map(r =>
          Object.fromEntries(columns.map((c, i) => [c, String(r[i] ?? '')])));
        if (json.length === 0) { toast.error('El archivo solo tiene encabezados'); return; }
        if (noHeaders) toast('El archivo no tiene fila de encabezados: se tomó la primera fila como dato. Asigna cada columna a su campo.', { icon: 'ℹ️', duration: 6000 });
        setExcelColumns(columns); setExcelData(json);
        if (filteredVars.length > 0) {
          const mapping: Record<string, string> = {};
          columns.forEach(col => { const match = filteredVars.find(v => v.toLowerCase() === col.toLowerCase().replace(/\s+/g, '_')); if (match) mapping[col] = match; });
          setColumnMapping(mapping);
        }
        toast.success(`${json.length} filas cargadas`);
      } catch { toast.error('Error al leer archivo'); }
    };
    reader.readAsArrayBuffer(file);
  }, [filteredVars]);

  const handleImportMassive = async () => {
    if (!selectedTemplate || excelData.length === 0) { toast.error('Selecciona plantilla y datos'); return; }
    setImporting(true); setImportProgress({ current: 0, total: excelData.length });
    if (isEditMode && originalRequestId) {
      try {
        const { data: originalReq } = await supabase.from('certificate_requests').select('batch_id').eq('id', originalRequestId).single();
        if (!originalReq?.batch_id) { toast.error('Lote no encontrado'); setImporting(false); return; }
        const batchId = originalReq.batch_id;
        const { data: existingBatch } = await supabase.from('certificate_requests').select('id, row_index').eq('batch_id', batchId).order('row_index');
        if (!existingBatch) { setImporting(false); return; }
        let updatedCount = 0;
        for (let i = 0; i < Math.min(excelData.length, existingBatch.length); i++) {
          const mappedData: Record<string, string> = {};
          Object.entries(columnMapping).forEach(([excelCol, templateVar]) => { if (!templateVar) return; const value = excelData[i][excelCol]; if (value !== undefined && String(value).trim() !== '') mappedData[templateVar] = String(value); });
          const { error } = await supabase.from('certificate_requests').update({ data: mappedData }).eq('id', existingBatch[i].id);
          if (!error) updatedCount++;
          setImportProgress({ current: i + 1, total: existingBatch.length });
        }
        toast.success(`${updatedCount} solicitudes actualizadas`);
        navigate('/requests');
      } catch (err: any) { toast.error('Error: ' + err.message); setImporting(false); }
    } else {
      const batchId = crypto.randomUUID();
      const allRows = excelData.map((row, i) => {
        const mappedData: Record<string, string> = {};
        Object.entries(columnMapping).forEach(([excelCol, templateVar]) => { if (!templateVar) return; const value = row[excelCol]; if (value !== undefined && String(value).trim() !== '') mappedData[templateVar] = String(value); });
        return { code: `MAS-${batchId.substring(0, 6).toUpperCase()}-${String(i + 1).padStart(4, '0')}`, type: 'MASSIVE', status: 'PENDING', user_id: user?.id, template_id: selectedTemplate.id, data: mappedData, batch_id: batchId, batch_total: excelData.length, row_index: i, original_data: row };
      });
      try { await supabase.from('certificate_requests').insert(allRows); toast.success(`${allRows.length} solicitudes creadas`); navigate('/requests'); }
      catch (err: any) { toast.error('Error: ' + err.message); setImporting(false); }
    }
  };

  const downloadTemplate = () => {
    if (!filteredVars.length || !selectedTemplate) return;
    const safeName = selectedTemplate.name.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/gi, '').replace(/\s+/g, '_').substring(0, 40);
    const getExample = (v: string): string => { const lower = v.toLowerCase(); if (lower.includes('nombre')) return 'Ej: Juan Pérez'; if (lower.includes('documento') || lower.includes('cedula')) return 'Ej: 1234567890'; if (lower.includes('fecha')) return '20/06/2026'; return `Ej: ${v.replace(/_/g, ' ')}`; };
    const exampleRow: Record<string, string> = {}; filteredVars.forEach(v => { exampleRow[v] = getExample(v); });
    const ws = XLSX.utils.json_to_sheet([exampleRow]); ws['!cols'] = filteredVars.map(v => ({ wch: Math.max(v.replace(/_/g, ' ').length + 5, 22) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.writeFile(wb, `${safeName}.xlsx`);
  };

  // ── Animation helper classes ──
  const viewTransitionClass = viewTransition === 'entering' ? 'animate-fade-in' : viewTransition === 'leaving' ? 'opacity-0 -translate-y-2' : '';
  const staggerClass = (i: number) => `opacity-0 animate-[slideUp_0.4s_ease-out_forwards]` + ` [animation-delay:${80 + i * 60}ms]`;

  if (loadingTemplates) {
    return <div className="max-w-4xl mx-auto px-4 md:px-6"><SkeletonCard variant="form" count={1} /></div>;
  }

  // ── TYPE SELECTION ──
  const renderTypeSelection = () => (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-[42px] font-bold text-slate-800 tracking-tight leading-tight">Nueva solicitud</h1>
        <p className="text-gray-500 text-base md:text-lg">Solicita la emisión de certificados</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-6">
        {[{ type: 'single' as const, icon: FileText, title: 'Solicitud única', desc: 'Crea una solicitud de certificado llenando el formulario manualmente. Ideal para casos individuales o pruebas rápidas.' },
          { type: 'multiple' as const, icon: Upload, title: 'Múltiples solicitudes', desc: 'Importa un archivo Excel con los datos de varios certificados. Cada fila generará una solicitud independiente.' }
        ].map((item, i) => (
          <div key={item.type} onClick={() => handleTypeSelect(item.type)}
            className={`${staggerClass(i)} bg-white p-6 md:p-8 rounded-3xl border-2 border-transparent hover:border-green-500 hover:shadow-xl active:scale-[0.98] transition-all duration-300 cursor-pointer group shadow-sm`}>
            <div className="w-12 h-12 md:w-14 md:h-14 bg-green-50 rounded-2xl flex items-center justify-center mb-5 md:mb-6 group-hover:scale-110 group-hover:bg-green-100 transition-all duration-300">
              <item.icon className="w-6 h-6 md:w-7 md:h-7 text-green-600" />
            </div>
            <h3 className="text-lg md:text-xl font-bold text-slate-800 mb-2">{item.title}</h3>
            <p className="text-gray-500 leading-relaxed text-sm md:text-base">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  // ── TEMPLATE SELECTION ──
  const renderTemplateSelection = () => {
    const selectedVars = selectedTemplate
      ? extractTemplateVariables(selectedTemplate).filter((v: string) => !SYSTEM_VARS.has(v))
      : [];
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-1">
          <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3 group -ml-1">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
            <span className="group-hover:underline">Volver</span>
          </button>
          <h1 className="text-3xl md:text-[42px] font-bold text-slate-800 tracking-tight">¿Qué documento necesitas?</h1>
          <p className="text-gray-500 text-base md:text-lg">
            {requestType === 'multiple' ? 'Elige la plantilla; después subirás el Excel con todos los datos.' : 'Elige la plantilla; después llenarás sus campos.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={templateSearch}
              onChange={e => setTemplateSearch(e.target.value)}
              placeholder="Buscar por nombre o código"
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none text-sm"
            />
          </div>
          {categories.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0" role="tablist" aria-label="Categoría">
              {['all', ...categories].map(c => (
                <button
                  key={c}
                  role="tab"
                  aria-selected={categoryFilter === c}
                  onClick={() => setCategoryFilter(c)}
                  className={`px-3.5 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${categoryFilter === c ? 'bg-slate-800 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  {c === 'all' ? 'Todas' : c}
                </button>
              ))}
            </div>
          )}
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <FileText size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-500 mb-1">No hay plantillas disponibles</p>
            <p className="text-sm text-gray-400">Contacta al administrador para asignar plantillas</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
            <ul className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {visibleTemplates.length === 0 && (
                <li className="p-8 text-center text-sm text-gray-500">Ninguna plantilla coincide con “{templateSearch}”.</li>
              )}
              {visibleTemplates.map(template => {
                const isSelected = selectedTemplate?.id === template.id;
                const fieldCount = extractTemplateVariables(template).filter((v: string) => !SYSTEM_VARS.has(v)).length;
                return (
                  <li key={template.id}>
                    <button
                      onClick={() => handleTemplateSelect(template)}
                      onDoubleClick={() => { handleTemplateSelect(template); handleContinueToForm(); }}
                      aria-pressed={isSelected}
                      className={`w-full flex items-center gap-4 p-4 text-left transition-colors ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                    >
                      <TemplateThumb config={template.config} width={72} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-800 truncate">{template.name}</span>
                        <span className="block text-sm text-gray-500 line-clamp-1">{template.description || template.code}</span>
                        <span className="block text-xs text-gray-400 mt-1 tabular-nums">
                          {fieldCount === 0 ? 'Sin campos por llenar' : `${fieldCount} campo${fieldCount !== 1 ? 's' : ''}`}
                          {template.category ? ` · ${template.category}` : ''}
                        </span>
                      </span>
                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-green-600 bg-green-600' : 'border-gray-300'}`}>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <aside className="lg:sticky lg:top-6 bg-white rounded-2xl border border-gray-100 p-5">
              {selectedTemplate ? (
                <div className="space-y-4">
                  <div className="flex justify-center bg-gray-50 rounded-xl py-5">
                    <TemplateThumb config={selectedTemplate.config} width={200} />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800">{selectedTemplate.name}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {getPageSizeLabel(normalizePageSize(selectedTemplate.config?.pageSize))} · {selectedTemplate.config?.orientation === 'portrait' ? 'vertical' : 'horizontal'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1.5">Datos que se piden</p>
                    {selectedVars.length === 0 ? (
                      <p className="text-sm text-gray-500">Ninguno, el documento se genera tal cual.</p>
                    ) : (
                      <ul className="text-sm text-slate-700 space-y-0.5 max-h-40 overflow-y-auto">
                        {selectedVars.map((v: string) => <li key={v} className="capitalize">{v.replace(/_/g, ' ')}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-8 text-center">Selecciona una plantilla para ver su vista previa y los datos que pide.</p>
              )}
            </aside>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 pb-4">
          <button onClick={handleBack} className="px-5 py-3 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition-colors border border-gray-200 bg-white text-sm md:text-base">Cancelar</button>
          <button disabled={!selectedTemplate} onClick={handleContinueToForm}
            className={`flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-medium transition-all duration-200 text-sm md:text-base ${selectedTemplate ? 'bg-green-600 text-white hover:bg-green-700 active:scale-[0.97]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            Continuar <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </div>
    );
  };

  // ── SINGLE FORM ──
  const renderSingleForm = () => (
    <form onSubmit={handleIndividualSubmit} noValidate className="bg-white p-5 md:p-8 rounded-3xl shadow-sm border border-gray-100 animate-[slideUp_0.4s_ease-out_forwards]">
      <div className="mb-6 md:mb-8 flex items-center gap-3 border-b border-gray-100 pb-5 md:pb-6">
        <TemplateThumb config={selectedTemplate?.config} width={44} />
        <div>
          <h2 className="text-base md:text-lg font-bold text-slate-800">Datos del certificado</h2>
          <p className="text-xs md:text-sm text-gray-500">
            Completa la información para <span className="font-semibold text-green-600">{selectedTemplate?.name}</span>
            {filteredVars.length > 0 && (
              <span className="tabular-nums"> · {filteredVars.filter(v => formData[v]?.toString().trim()).length} de {filteredVars.length} completos</span>
            )}
          </p>
        </div>
      </div>

      {filteredVars.length === 0 ? (
        <div className="text-center py-8 md:py-12">
          <CheckCircle size={40} className="mx-auto text-green-300 mb-3" />
          <p className="text-base font-semibold text-gray-500">Sin campos requeridos</p>
          <p className="text-sm text-gray-400 mt-1">Esta plantilla no requiere datos adicionales</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 md:gap-x-6 gap-y-4 md:gap-y-5">
          {filteredVars.map((variable, i) => (
            <div key={variable} className={staggerClass(i)}>
              <label className="block text-sm font-semibold text-slate-700 mb-2 capitalize">{variable.replace(/_/g, ' ')} <span className="text-red-500" aria-hidden>*</span></label>
              {['fecha', 'date'].includes(variable) || variable.toLowerCase().includes('fecha') ? (
                <input type="date"
                  className="w-full p-3 md:p-3.5 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none transition-all text-slate-600 text-sm md:text-base"
                  value={formData[variable] || ''} onChange={e => setFormData({ ...formData, [variable]: e.target.value })} />
              ) : ['horas', 'horas_', 'duracion'].includes(variable) || variable.toLowerCase().includes('hora') ? (
                <input type="number" placeholder="Ej: 120"
                  className="w-full p-3 md:p-3.5 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none transition-all text-slate-600 placeholder-gray-400 text-sm md:text-base"
                  value={formData[variable] || ''} onChange={e => setFormData({ ...formData, [variable]: e.target.value })} />
              ) : ['email', 'correo', 'mail'].includes(variable) ? (
                <input type="email" placeholder={`Ingresa ${variable.replace(/_/g, ' ')}`}
                  className="w-full p-3 md:p-3.5 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none transition-all text-slate-600 placeholder-gray-400 text-sm md:text-base"
                  value={formData[variable] || ''} onChange={e => setFormData({ ...formData, [variable]: e.target.value })} />
              ) : (
                <input type="text" placeholder={`Ingresa ${variable.replace(/_/g, ' ')}`}
                  className="w-full p-3 md:p-3.5 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none transition-all text-slate-600 placeholder-gray-400 text-sm md:text-base"
                  value={formData[variable] || ''} onChange={e => setFormData({ ...formData, [variable]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      )}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
    </form>
  );

  // ── MULTIPLE UPLOAD ──
  const renderMultipleUpload = () => (
    <div className="bg-white p-6 md:p-10 rounded-3xl shadow-sm border border-gray-100 animate-[slideUp_0.4s_ease-out_forwards]">
      {excelData.length === 0 ? (
        <div className="max-w-lg mx-auto space-y-5 md:space-y-6">
          <button onClick={downloadTemplate} className="flex items-center gap-2 text-sm font-medium text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-4 py-2 rounded-full transition-all duration-200 mx-auto">
            <Download className="w-4 h-4" /> Descargar plantilla Excel
          </button>
          <div className="border-2 border-dashed border-gray-200 bg-gray-50 rounded-3xl p-8 md:p-12 transition-all duration-300 hover:border-green-400 hover:bg-green-50/50 group">
            <div className="w-14 h-14 md:w-16 md:h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-5 md:mb-6 group-hover:scale-110 group-hover:shadow-md transition-all duration-300">
              <FileUp className="w-7 h-7 md:w-8 md:h-8 text-green-500" />
            </div>
            <h3 className="text-lg md:text-xl font-bold text-slate-800 mb-2">Importar desde Excel</h3>
            <p className="text-gray-500 text-xs md:text-sm mb-6 md:mb-8 leading-relaxed px-2">
              Sube un archivo Excel (.xlsx o .csv). Cada fila será una solicitud independiente para <span className="font-semibold text-slate-700">{selectedTemplate?.name}</span>.
            </p>
            <button onClick={() => fileInputRef.current?.click()}
              className="relative overflow-hidden flex items-center justify-center gap-2 w-full bg-green-500 text-white px-5 md:px-6 py-3 md:py-3.5 rounded-xl font-medium hover:bg-green-600 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md text-sm md:text-base">
              <Upload className="w-4 h-4 md:w-5 md:h-5" /> Seleccionar archivo
              <input ref={fileInputRef} type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 md:p-5 rounded-2xl space-y-3 border border-gray-100 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <h3 className="text-xs md:text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><AlertCircle size={14} /> Mapeo de columnas</h3>
              <button onClick={() => { setExcelData([]); setExcelColumns([]); setColumnMapping({}); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Cambiar</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {excelColumns.map(col => (
                <div key={col} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2.5 border border-gray-200">
                  <span className="text-xs md:text-sm font-medium text-slate-700 w-1/3 truncate">{col}</span>
                  <span className="text-gray-300 text-xs">→</span>
                  <select className="text-xs md:text-sm bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 flex-1 focus:border-green-500 outline-none" value={columnMapping[col] || ''} onChange={e => setColumnMapping({ ...columnMapping, [col]: e.target.value })}>
                    <option value="">No importar</option>
                    {filteredVars.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden border border-gray-100">
            <div className="flex items-center justify-between px-4 md:px-5 py-3 md:py-4 border-b border-gray-100 bg-gray-50/50">
              <span className="font-semibold text-xs md:text-sm text-slate-800 flex items-center gap-2"><Table size={16} className="text-green-600" /> {excelData.length} filas</span>
            </div>
            <div className="overflow-x-auto max-h-48 md:max-h-64 overflow-y-auto">
              <table className="w-full text-xs md:text-sm">
                <thead><tr className="bg-gray-50">{excelColumns.map(col => <th key={col} className="text-left px-3 md:px-4 py-2 md:py-3 font-bold text-gray-500 uppercase whitespace-nowrap">{col}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {excelData.slice(0, 15).map((row, i) => (
                    <tr key={i} className="hover:bg-green-50/30">{excelColumns.map(col => <td key={col} className="px-3 md:px-4 py-2 text-gray-600 truncate max-w-[150px] md:max-w-[200px]">{row[col] || '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {importing && (
            <div className="p-4 rounded-2xl border border-green-200 bg-green-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-800">Importando...</span>
                <span className="text-sm text-gray-500">{importProgress.current}/{importProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden"><div className="bg-green-500 h-full rounded-full transition-all duration-300" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }} /></div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── MAIN RETURN ──
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 animate-fade-in">
      {/* Edit/Reuse banner */}
      {(isEditMode || isReuseMode) && (
        <div className="bg-amber-50 rounded-2xl p-4 md:p-5 border border-amber-200/70 mb-6 animate-[slideUp_0.3s_ease-out_forwards]">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-800">{isAdminEdit ? 'Corrección de administrador' : isEditMode ? 'Editando solicitud' : 'Reutilizando datos'}</h3>
              {isAdminEdit && (
                <p className="text-xs text-amber-700/80 mt-1">
                  Al guardar, la solicitud vuelve a <strong>Pendiente</strong> y el firmante autorizado deberá validarla otra vez.
                  {originalStatus === 'APPROVED' && ' La firma y el PDF generados antes se descartan; el radicado se conserva.'}
                </p>
              )}
              {originalRejectionReason && <p className="text-xs text-amber-700/80 mt-1">Motivo: {originalRejectionReason}</p>}
            </div>
          </div>
        </div>
      )}

      {/* View orchestrator with transition */}
      <div className={`transition-all duration-300 ${viewTransitionClass}`}>
        {currentView === 'TYPE_SELECTION' && renderTypeSelection()}
        {currentView === 'TEMPLATE_SELECTION' && renderTemplateSelection()}
        {currentView === 'ACTION_AREA' && (
          <div className="space-y-6 md:space-y-8">
            <div className="space-y-1">
              <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3 md:mb-4 group -ml-1">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                <span className="group-hover:underline">Volver a plantillas</span>
              </button>
              <h1 className="text-3xl md:text-[42px] font-bold text-slate-800 tracking-tight">{isEditMode ? 'Editar solicitud' : 'Nueva solicitud'}</h1>
              <p className="text-gray-500 text-sm md:text-base">{requestType === 'single' ? 'Completa los datos del certificado' : 'Importa datos desde Excel'}</p>
            </div>

            {requestType === 'single' ? renderSingleForm() : renderMultipleUpload()}

            {isAdminEdit && (
              <div className="bg-white p-5 md:p-6 rounded-3xl border border-amber-200">
                <label htmlFor="correction-reason" className="block text-sm font-semibold text-slate-700 mb-2">
                  ¿Qué se corrigió? <span className="text-red-500" aria-hidden>*</span>
                </label>
                <textarea
                  id="correction-reason"
                  rows={3}
                  value={correctionReason}
                  onChange={e => setCorrectionReason(e.target.value)}
                  placeholder="Ej.: se corrigió el número de documento y la intensidad horaria"
                  className="w-full p-3 rounded-xl border border-gray-200 focus:border-green-500 focus:ring-4 focus:ring-green-50 outline-none text-sm"
                />
                <p className="text-xs text-gray-400 mt-1.5">El firmante verá este mensaje al revisar la solicitud.</p>
              </div>
            )}

            {/* Final actions */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 pb-6 md:pb-8 animate-[slideUp_0.4s_ease-out_0.1s_forwards] opacity-0">
              <button onClick={handleBack} className="px-5 py-3 rounded-xl text-gray-600 border border-gray-200 font-medium hover:bg-gray-100 active:bg-gray-200 transition-colors bg-white text-sm md:text-base">Cancelar</button>
              {requestType === 'single' ? (
                <button onClick={handleIndividualSubmit} disabled={savingIndividual}
                  className="flex items-center justify-center gap-2 px-6 md:px-8 py-3 rounded-xl font-medium transition-all duration-200 bg-green-500 text-white hover:bg-green-600 active:scale-[0.97] disabled:opacity-50 text-sm md:text-base">
                  {savingIndividual ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4 md:w-5 md:h-5" />}
                  {isAdminEdit ? 'Guardar y enviar al firmante' : isEditMode ? 'Actualizar' : 'Crear solicitud'}
                </button>
              ) : (
                <button onClick={handleImportMassive} disabled={importing || excelData.length === 0}
                  className="flex items-center justify-center gap-2 px-6 md:px-8 py-3 rounded-xl font-medium transition-all duration-200 bg-green-500 text-white hover:bg-green-600 active:scale-[0.97] disabled:opacity-50 text-sm md:text-base">
                  {importing ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Upload className="w-4 h-4 md:w-5 md:h-5" />}
                  {isEditMode ? `Actualizar` : `Importar ${excelData.length} solicitudes`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
