import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  ArrowLeft, Save, FileText, Upload, Table, AlertCircle, CheckCircle, Download,
  FileBadge, GraduationCap, Award, ScrollText, ChevronRight, FileUp, CheckCircle2
} from 'lucide-react';
import { requestsApi, auditApi, getClientIP } from '../../services/api';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { SkeletonCard } from '../../components/ui/SkeletonCard';

export const SYSTEM_VARS = new Set(['codigo', 'codigo_certificado', 'radicado', 'consecutivo']);

type CreationType = 'single' | 'multiple';
type StepView = 'TYPE_SELECTION' | 'TEMPLATE_SELECTION' | 'ACTION_AREA';

const templateStyleMap: Record<string, { icon: any; color: string; bgColor: string; gradient: string }> = {
  notas: { icon: FileBadge, color: 'text-blue-500', bgColor: 'bg-blue-50', gradient: 'from-blue-500/10 to-blue-600/5' },
  constancia: { icon: GraduationCap, color: 'text-emerald-500', bgColor: 'bg-emerald-50', gradient: 'from-emerald-500/10 to-emerald-600/5' },
  diploma: { icon: Award, color: 'text-amber-500', bgColor: 'bg-amber-50', gradient: 'from-amber-500/10 to-amber-600/5' },
  acta: { icon: ScrollText, color: 'text-purple-500', bgColor: 'bg-purple-50', gradient: 'from-purple-500/10 to-purple-600/5' },
  default: { icon: FileText, color: 'text-green-500', bgColor: 'bg-green-50', gradient: 'from-green-500/10 to-green-600/5' },
};

const getTemplateStyle = (category: string | null) => {
  if (!category) return templateStyleMap.default;
  const key = category.toLowerCase();
  for (const [k, v] of Object.entries(templateStyleMap)) {
    if (key.includes(k)) return v;
  }
  return templateStyleMap.default;
};

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
  const isReuseMode = Boolean(reuseId && !editId);

  // Step view state with transition tracking
  const [currentView, setCurrentView] = useState<StepView>('TYPE_SELECTION');
  const [viewTransition, setViewTransition] = useState<'entering' | 'leaving' | 'idle'>('idle');
  const [requestType, setRequestType] = useState<CreationType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);

  // Templates from database
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Template variables & form
  const [filteredVars, setFilteredVars] = useState<string[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [savingIndividual, setSavingIndividual] = useState(false);

  // Edit mode
  const [originalRequestId, setOriginalRequestId] = useState<string | null>(null);
  const [originalBatchId, setOriginalBatchId] = useState<string | null>(null);
  const [originalRejectedId, setOriginalRejectedId] = useState<string | null>(null);
  const [originalRejectionReason, setOriginalRejectionReason] = useState<string | null>(null);

  // Massive import
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  // ── Load templates ──
  useEffect(() => { if (user) loadTemplates(); }, [user]);
  useEffect(() => { if (reuseId && user && !editId) loadRejectedData(); }, [reuseId, user, editId]);
  useEffect(() => { if (editId && user) loadExistingRequest(); }, [editId, user]);

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

  const loadRejectedData = async () => {
    try {
      const { data, error } = await supabase.from('certificate_requests').select('*, template:templates(name)').eq('id', reuseId).single();
      if (error) throw error;
      if (!data) { toast.error('Solicitud no encontrada'); navigate('/requests'); return; }
      if (data.user_id !== user?.id) { toast.error('No tienes permiso'); navigate('/requests'); return; }
      setOriginalRejectedId(reuseId);
      setOriginalRejectionReason(data.rejection_reason);
      if (data.data && typeof data.data === 'object') setFormData(data.data as Record<string, string>);
      const template = templates.find(t => t.id === data.template_id);
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
      if (data.user_id !== user?.id) { toast.error('No tienes permiso'); navigate('/requests'); return; }
      const editableStatuses = ['DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED'];
      if (!editableStatuses.includes(data.status)) { toast.error('No puede editarse'); navigate('/requests'); return; }
      setRequestType(data.type === 'MASSIVE' || data.batch_id ? 'multiple' : 'single');
      const template = templates.find(t => t.id === data.template_id);
      if (template) { setSelectedTemplate(template); handleTemplateSelect(template, false); }
      if (data.data && typeof data.data === 'object') setFormData(data.data as Record<string, string>);
      setOriginalRequestId(editId!);
      if (data.batch_id) setOriginalBatchId(data.batch_id);
      setCurrentView('ACTION_AREA');
    } catch (err: any) { toast.error('Error al cargar solicitud'); navigate('/requests'); }
  };

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
      const dataToSend = Object.fromEntries(Object.entries(formData).filter(([, v]) => v !== ''));
      if (isEditMode && originalRequestId) {
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
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false, defval: '' });
        if (json.length === 0) { toast.error('Archivo vacío'); return; }
        const columns = Object.keys(json[0]);
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
  const renderTemplateSelection = () => (
    <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
      <div className="space-y-1">
        <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3 md:mb-4 group -ml-1">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
          <span className="group-hover:underline">Volver</span>
        </button>
        <h1 className="text-3xl md:text-[42px] font-bold text-slate-800 tracking-tight">Seleccionar plantilla</h1>
        <p className="text-gray-500 text-base md:text-lg">Elige el tipo de documento que deseas solicitar</p>
      </div>

      <div className="bg-white p-5 md:p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="mb-5 md:mb-6 flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-xl"><FileText className="w-5 h-5 text-green-600" /></div>
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-800">Tipos de documento</h2>
            <p className="text-xs md:text-sm text-gray-500">{templates.length} plantilla{templates.length !== 1 ? 's' : ''} disponible{templates.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-10 md:py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><FileText size={32} className="text-gray-300" /></div>
            <p className="text-lg font-semibold text-gray-500 mb-1">No hay plantillas disponibles</p>
            <p className="text-sm text-gray-400">Contacta al administrador para asignar plantillas</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {templates.map((template, i) => {
              const style = getTemplateStyle(template.category);
              const Icon = style.icon;
              const isSelected = selectedTemplate?.id === template.id;
              return (
                <div key={template.id} onClick={() => handleTemplateSelect(template)}
                  className={`${staggerClass(i)} relative p-4 md:p-5 rounded-2xl cursor-pointer transition-all duration-300 border-2 text-left active:scale-[0.97] ${isSelected ? 'border-green-500 bg-gradient-to-br ' + style.gradient + ' shadow-lg ring-4 ring-green-500/10' : 'border-gray-100 bg-white hover:border-green-200 hover:shadow-md hover:-translate-y-0.5'}`}>
                  <div className={`absolute top-3 right-3 md:top-4 md:right-4 transition-all duration-300 ${isSelected ? 'scale-100 rotate-0' : 'scale-0 rotate-45'}`}>
                    <CheckCircle2 className="w-6 h-6 text-green-500 drop-shadow-sm" />
                  </div>
                  <div className="flex items-start gap-3 md:gap-4">
                    <div className={`p-2.5 md:p-3 rounded-xl ${style.bgColor} ${style.color} transition-transform duration-300 ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`}>
                      <Icon className="w-7 h-7 md:w-8 md:h-8" />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <h3 className={`font-semibold mb-1 text-sm md:text-base ${isSelected ? 'text-green-900' : 'text-slate-800'}`}>{template.name}</h3>
                      <p className={`text-xs md:text-sm leading-relaxed line-clamp-2 ${isSelected ? 'text-green-700/70' : 'text-gray-500'}`}>
                        {template.description || template.code || 'Certificado disponible'}
                      </p>
                      {template.category && (
                        <span className="inline-block mt-2 text-[10px] md:text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{template.category}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom actions - sticky on mobile */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 pb-4 md:pb-0">
        <button onClick={handleBack} className="px-5 py-3 rounded-xl text-gray-600 font-medium hover:bg-gray-100 active:bg-gray-200 transition-colors border border-gray-200 bg-white text-sm md:text-base">Cancelar</button>
        <button disabled={!selectedTemplate} onClick={handleContinueToForm}
          className={`flex items-center justify-center gap-2 px-6 md:px-8 py-3 rounded-xl font-medium transition-all duration-300 text-sm md:text-base ${selectedTemplate ? 'bg-green-500 text-white hover:bg-green-600 hover:shadow-lg active:scale-[0.97]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
          Continuar <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      </div>
    </div>
  );

  // ── SINGLE FORM ──
  const renderSingleForm = () => (
    <div className="bg-white p-5 md:p-8 rounded-3xl shadow-sm border border-gray-100 animate-[slideUp_0.4s_ease-out_forwards]">
      <div className="mb-6 md:mb-8 flex items-center gap-3 border-b border-gray-100 pb-5 md:pb-6">
        <div className="p-2 bg-green-50 rounded-xl"><FileText className="w-5 h-5 text-green-600" /></div>
        <div>
          <h2 className="text-base md:text-lg font-bold text-slate-800">Datos del certificado</h2>
          <p className="text-xs md:text-sm text-gray-500">
            Completa la información para <span className="font-semibold text-green-600">{selectedTemplate?.name}</span>
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
              <label className="block text-sm font-semibold text-slate-700 mb-2 capitalize">{variable.replace(/_/g, ' ')}</label>
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
    </div>
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
              <h3 className="text-sm font-bold text-amber-800">{isEditMode ? 'Editando solicitud' : 'Reutilizando datos'}</h3>
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

            {/* Final actions */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 pb-6 md:pb-8 animate-[slideUp_0.4s_ease-out_0.1s_forwards] opacity-0">
              <button onClick={handleBack} className="px-5 py-3 rounded-xl text-gray-600 border border-gray-200 font-medium hover:bg-gray-100 active:bg-gray-200 transition-colors bg-white text-sm md:text-base">Cancelar</button>
              {requestType === 'single' ? (
                <button onClick={handleIndividualSubmit} disabled={savingIndividual}
                  className="flex items-center justify-center gap-2 px-6 md:px-8 py-3 rounded-xl font-medium transition-all duration-200 bg-green-500 text-white hover:bg-green-600 active:scale-[0.97] disabled:opacity-50 text-sm md:text-base">
                  {savingIndividual ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4 md:w-5 md:h-5" />}
                  {isEditMode ? 'Actualizar' : 'Crear solicitud'}
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
