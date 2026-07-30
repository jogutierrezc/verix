import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Save, FileText, Upload, Table, AlertCircle, CheckCircle, Download } from 'lucide-react';
import { requestsApi } from '../../services/api';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { SkeletonCard } from '../../components/ui/SkeletonCard';

/** Variables del sistema que se asignan automáticamente (no se muestran al usuario) */
const SYSTEM_VARS = new Set(['codigo', 'codigo_certificado', 'radicado', 'consecutivo']);

type CreationType = 'single' | 'multiple';

const extractTemplateVariables = (template: any): string[] => {
  if (template?.config && Array.isArray(template.config.elements)) {
    const regex = /{{\s*([^}\s]+)\s*}}/g;
    const vars = new Set<string>();

    template.config.elements.forEach((el: any) => {
      if (typeof el.content === 'string') {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(el.content)) !== null) {
          vars.add(match[1]);
        }
      }
    });

    if (vars.size > 0) {
      return Array.from(vars);
    }
  }

  if (template?.variables && Array.isArray(template.variables)) {
    return template.variables;
  }

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

  // ── State for reuse mode: show original rejection info ──
  const [originalRejectedId, setOriginalRejectedId] = useState<string | null>(null);
  const [originalRejectionReason, setOriginalRejectionReason] = useState<string | null>(null);

  // Step 1: choose single or multiple
  const [creationType, setCreationType] = useState<CreationType | null>(null);

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [filteredVars, setFilteredVars] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Individual form
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [savingIndividual, setSavingIndividual] = useState(false);

  // Edit mode
  const [originalRequestId, setOriginalRequestId] = useState<string | null>(null);
  const [originalBatchId, setOriginalBatchId] = useState<string | null>(null);

  // Massive import
  const [excelData, setExcelData] = useState<Record<string, string>[]>([]);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!user) return;
    loadTemplates();
  }, [user]);

  // ── Reuse mode: load rejected request data ──
  useEffect(() => {
    if (!reuseId || !user || editId) return;
    loadRejectedData();
  }, [reuseId, user, editId]);

  const loadRejectedData = async () => {
    try {
      const { data, error } = await supabase
        .from('certificate_requests')
        .select('*, template:templates(name)')
        .eq('id', reuseId)
        .single();

      if (error) throw error;
      if (!data) { toast.error('Solicitud no encontrada'); navigate('/requests'); return; }

      // Verify ownership
      if (data.user_id !== user?.id) {
        toast.error('No tienes permiso para reutilizar esta solicitud');
        navigate('/requests');
        return;
      }

      // Auto-select single mode
      setCreationType('single');

      // Pre-fill form data (but NOT template - user selects new one)
      if (data.data && typeof data.data === 'object') {
        setFormData(data.data as Record<string, string>);
      }

      setOriginalRejectedId(reuseId);
      setOriginalRejectionReason(data.rejection_reason);

      toast.success('Datos de solicitud rechazada cargados. Selecciona una plantilla y corrige los datos.');
    } catch (err: any) {
      console.error('Error loading rejected request:', err);
      toast.error('Error al cargar los datos de la solicitud');
      navigate('/requests');
    }
  };

  // ── Edit mode: load existing request ──
  useEffect(() => {
    if (!editId || !user) return;
    loadExistingRequest();
  }, [editId, user]);

  const loadExistingRequest = async () => {
    try {
      const { data, error } = await supabase
        .from('certificate_requests')
        .select('*')
        .eq('id', editId)
        .single();

      if (error) throw error;
      if (!data) { toast.error('Solicitud no encontrada'); navigate('/requests'); return; }

      // Verify ownership
      if (data.user_id !== user?.id) {
        toast.error('No tienes permiso para editar esta solicitud');
        navigate('/requests');
        return;
      }

      // Verify editable status
      const editableStatuses = ['DRAFT', 'PENDING', 'IN_REVIEW', 'REJECTED'];
      if (!editableStatuses.includes(data.status)) {
        toast.error('Esta solicitud ya no puede ser editada');
        navigate('/requests');
        return;
      }

      // Set type based on the request
      if (data.type === 'MASSIVE' || data.batch_id) {
        setCreationType('multiple');
      } else {
        setCreationType('single');
      }

      // Set template
      setSelectedTemplate(data.template_id);

      // Pre-fill form data
      if (data.data && typeof data.data === 'object') {
        const rawData = data.data as Record<string, string>;
        setFormData(rawData);
      }

      // Store original data for reference
      setOriginalRequestId(editId!);
      if (data.batch_id) setOriginalBatchId(data.batch_id);
    } catch (err: any) {
      console.error('Error loading request for edit:', err);
      toast.error('Error al cargar la solicitud');
      navigate('/requests');
    }
  };

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      // Only show templates assigned to the user's dependency
      if (!user?.dependency_id) {
        setTemplates([]);
        return;
      }

      const { data } = await supabase
        .from('templates')
        .select('id, name, code, description, variables, category, config')
        .eq('is_active', true)
        .eq('dependency_id', user.dependency_id)
        .order('name');

      setTemplates(data || []);
    } catch (err) {
      console.error('Error loading templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleTemplateChange = useCallback((templateId: string) => {
    // In edit mode, don't reset form data if template is the same
    if (isEditMode && templateId === selectedTemplate) return;

    setSelectedTemplate(templateId);

    // Only reset form if not in edit/reuse mode or if template changed
    if ((!isEditMode && !isReuseMode) || templateId !== selectedTemplate) {
      setFormData({});
    }
    setExcelData([]);
    setExcelColumns([]);
    setColumnMapping({});

    const template = templates.find(t => t.id === templateId);
    if (template) {
      const vars = extractTemplateVariables(template);
      setTemplateVars(vars);

      // Filter out system variables from the form
      const visible = vars.filter((v: string) => !SYSTEM_VARS.has(v));
      setFilteredVars(visible);

      // In edit/reuse mode, don't reset formData — it's already loaded
      if (!isEditMode && !isReuseMode) {
        const initial: Record<string, string> = {};
        visible.forEach((v: string) => { initial[v] = ''; });
        setFormData(initial);
      }

      // Auto-map columns if coming from Excel
      if (creationType === 'multiple') {
        const mapping: Record<string, string> = {};
        excelColumns.forEach(col => {
          const match = visible.find(
            (v: string) => v.toLowerCase() === col.toLowerCase().replace(/\s+/g, '_')
          );
          if (match) mapping[col] = match;
        });
        setColumnMapping(mapping);
      }
    } else {
      setTemplateVars([]);
      setFilteredVars([]);
    }
  }, [templates, creationType, excelColumns, isEditMode, selectedTemplate]);

  // --- Individual submit (create or update) ---
  const handleIndividualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) {
      toast.error('Selecciona una plantilla');
      return;
    }

    setSavingIndividual(true);
    try {
      const dataToSend = Object.fromEntries(
        Object.entries(formData).filter(([_key, value]) => value !== ''),
      );

      if (isEditMode && originalRequestId) {
        // ── Update existing request ──
        await requestsApi.update(originalRequestId, {
          template_id: selectedTemplate,
          data: dataToSend,
        });

        // Audit log
        try {
          const { auditApi, getClientIP } = await import('../../services/api');
          const ip = await getClientIP();
          await auditApi.log({
            user_id: user?.id,
            user_email: user?.email,
            module: 'requests',
            action: 'update',
            entity_id: originalRequestId,
            entity_type: 'certificate_request',
            ip_address: ip,
            description: 'Solicitud editada por el solicitante',
          });
        } catch { /* silent */ }

        toast.success('Solicitud actualizada exitosamente');
      } else {
        // ── Create new request ──
        const code = `REQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        await requestsApi.create({
          code,
          type: 'INDIVIDUAL',
          status: 'PENDING',
          user_id: user?.id,
          template_id: selectedTemplate,
          data: dataToSend,
        });

        toast.success('Solicitud creada exitosamente');
      }

      navigate('/requests');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar la solicitud');
    } finally {
      setSavingIndividual(false);
    }
  };

  // --- Excel handling ---
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

        if (json.length === 0) {
          toast.error('El archivo Excel está vacío');
          return;
        }

        const columns = Object.keys(json[0]);
        setExcelColumns(columns);
        setExcelData(json);

        // Auto-map to filtered template variables if a template is selected
        if (selectedTemplate) {
          const mapping: Record<string, string> = {};
          columns.forEach(col => {
            const match = filteredVars.find(
              v => v.toLowerCase() === col.toLowerCase().replace(/\s+/g, '_')
            );
            if (match) mapping[col] = match;
          });
          setColumnMapping(mapping);
        }

        toast.success(`Se cargaron ${json.length} filas desde el Excel`);
      } catch (err) {
        toast.error('Error al leer el archivo Excel');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [selectedTemplate, filteredVars]);

  const handleImportMassive = async () => {
    if (!selectedTemplate) {
      toast.error('Selecciona una plantilla');
      return;
    }
    if (excelData.length === 0) {
      toast.error('No hay datos para importar');
      return;
    }

    setImporting(true);
    setImportProgress({ current: 0, total: excelData.length });

    if (isEditMode && originalRequestId) {
      // ── Edit mode: find the batch and update all items ──
      try {
        // Load the original request to get batch_id
        const { data: originalReq } = await supabase
          .from('certificate_requests')
          .select('batch_id')
          .eq('id', originalRequestId)
          .single();

        if (!originalReq?.batch_id) {
          toast.error('No se encontró el lote original');
          setImporting(false);
          return;
        }

        const batchId = originalReq.batch_id;

        // Get all existing requests in this batch
        const { data: existingBatch } = await supabase
          .from('certificate_requests')
          .select('id, row_index, code')
          .eq('batch_id', batchId)
          .order('row_index', { ascending: true });

        if (!existingBatch || existingBatch.length === 0) {
          toast.error('No se encontraron solicitudes en el lote');
          setImporting(false);
          return;
        }

        let updatedCount = 0;
        for (let i = 0; i < Math.min(excelData.length, existingBatch.length); i++) {
          const row = excelData[i];
          const existingReq = existingBatch[i];

          const mappedData: Record<string, string> = {};
          Object.entries(columnMapping).forEach(([excelCol, templateVar]) => {
            if (!templateVar) return;
            const value = row[excelCol];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
              mappedData[templateVar] = String(value);
            }
          });

          const { error: updateError } = await supabase
            .from('certificate_requests')
            .update({ data: mappedData })
            .eq('id', existingReq.id);

          if (!updateError) updatedCount++;
          setImportProgress({ current: i + 1, total: existingBatch.length });
        }

        // If there are more rows than existing items, add new ones
        if (excelData.length > existingBatch.length) {
          const newRows = [];
          for (let i = existingBatch.length; i < excelData.length; i++) {
            const row = excelData[i];
            const mappedData: Record<string, string> = {};
            Object.entries(columnMapping).forEach(([excelCol, templateVar]) => {
              if (!templateVar) return;
              const value = row[excelCol];
              if (value !== undefined && value !== null && String(value).trim() !== '') {
                mappedData[templateVar] = String(value);
              }
            });

            const code = `MAS-${batchId.substring(0, 6).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
            newRows.push({
              code,
              type: 'MASSIVE',
              status: 'PENDING',
              user_id: user?.id,
              template_id: selectedTemplate,
              data: mappedData,
              batch_id: batchId,
              batch_total: Math.max(excelData.length, existingBatch.length),
              row_index: i,
            });
          }

          if (newRows.length > 0) {
            const { error: insertError } = await supabase.from('certificate_requests').insert(newRows);
            if (insertError) throw insertError;

            // Update batch_total on all items
            const newTotal = Math.max(excelData.length, existingBatch.length);
            await supabase
              .from('certificate_requests')
              .update({ batch_total: newTotal })
              .eq('batch_id', batchId);
          }
        }

        // Audit log
        try {
          const { auditApi, getClientIP } = await import('../../services/api');
          const ip = await getClientIP();
          await auditApi.log({
            user_id: user?.id,
            user_email: user?.email,
            module: 'requests',
            action: 'batch_update',
            entity_id: batchId,
            entity_type: 'certificate_request_batch',
            ip_address: ip,
            description: `Lote editado masivamente por el solicitante (${updatedCount} actualizadas)`,
          });
        } catch { /* silent */ }

        toast.success(`✅ ${updatedCount} solicitudes actualizadas exitosamente`);
        navigate('/requests');
      } catch (err: any) {
        toast.error(`Error al actualizar lote: ${err.message || 'Error desconocido'}`);
        console.error('Batch update error:', err);
        setImporting(false);
      }
    } else {
      // ── Create new batch ──
      const batchId = crypto.randomUUID();
      const sourceFileName = fileInputRef.current?.files?.[0]?.name || null;

      const allRows = excelData.map((row, i) => {
        const mappedData: Record<string, string> = {};
        Object.entries(columnMapping).forEach(([excelCol, templateVar]) => {
          if (!templateVar) return;
          const value = row[excelCol];
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            mappedData[templateVar] = String(value);
          }
        });

        const code = `MAS-${batchId.substring(0, 6).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;

        return {
          code,
          type: 'MASSIVE',
          status: 'PENDING',
          user_id: user?.id,
          template_id: selectedTemplate,
          data: mappedData,
          batch_id: batchId,
          batch_total: excelData.length,
          row_index: i,
          source_file: sourceFileName,
          original_data: row,
        };
      });

      try {
        const { error } = await supabase.from('certificate_requests').insert(allRows);
        if (error) throw error;

        setImportProgress({ current: excelData.length, total: excelData.length });
        toast.success(`✅ ${allRows.length} solicitudes creadas exitosamente`);
        navigate('/requests');
      } catch (err: any) {
        toast.error(`Error al importar: ${err.message || 'Error desconocido'}`);
        console.error('Import error:', err);
        setImporting(false);
      }
    }
  };

  const downloadTemplate = () => {
    if (!filteredVars.length || !selectedTemplate) return;

    const template = templates.find(t => t.id === selectedTemplate);
    const templateName = template?.name || 'certificado';
    const safeName = templateName.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/gi, '').replace(/\s+/g, '_').substring(0, 40);

    // Generate example values based on variable name
    const getExample = (v: string): string => {
      const lower = v.toLowerCase();
      if (lower.includes('nombre')) return 'Ej: Juan Pérez';
      if (lower.includes('documento') || lower.includes('cedula') || lower.includes('identificacion') || lower.includes('id')) return 'Ej: 1234567890';
      if (lower.includes('email') || lower.includes('correo') || lower.includes('mail')) return 'ejemplo@correo.com';
      if (lower.includes('telefono') || lower.includes('celular') || lower.includes('teléfono')) return 'Ej: 3001234567';
      if (lower.includes('fecha') || lower.includes('date')) return '20/06/2026';
      if (lower.includes('curso') || lower.includes('programa') || lower.includes('carrera')) return 'Ej: Administración de Empresas';
      if (lower.includes('codigo') || lower.includes('matricula')) return 'Ej: 2024-001';
      if (lower.includes('direccion') || lower.includes('dirección')) return 'Ej: Cra 1 # 2-3';
      if (lower.includes('ciudad') || lower.includes('municipio')) return 'Ej: Valledupar';
      if (lower.includes('horas') || lower.includes('duracion') || lower.includes('duración')) return 'Ej: 120';
      if (lower.includes('nota') || lower.includes('calificacion') || lower.includes('promedio')) return 'Ej: 4.5';
      if (lower.includes('semestre') || lower.includes('periodo') || lower.includes('año')) return 'Ej: 2026-1';
      return `Ej: ${v.replace(/_/g, ' ')}`;
    };

    // Create example row
    const exampleRow: Record<string, string> = {};
    filteredVars.forEach(v => {
      exampleRow[v] = getExample(v);
    });

    const ws = XLSX.utils.json_to_sheet([exampleRow, {}]);

    // Set column widths for readability
    ws['!cols'] = filteredVars.map(v => ({ wch: Math.max(v.replace(/_/g, ' ').length + 5, 22) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    // Add instructions sheet
    const instructionsWs = XLSX.utils.aoa_to_sheet([
      ['INSTRUCCIONES - IMPORTACIÓN DE CERTIFICADOS'],
      [''],
      ['1. Esta plantilla contiene los campos necesarios para generar los certificados.'],
      ['2. La primera fila ("Ej: ...") contiene datos de ejemplo — reemplázalos con los datos reales.'],
      ['3. La segunda fila está vacía — ahí puedes empezar a escribir tus datos.'],
      ['4. Cada fila del archivo generará UNA solicitud de certificado independiente.'],
      ['5. No modifiques los encabezados de columna (primera fila).'],
      ['6. Los campos: código, radicado y consecutivo se asignan automáticamente.'],
      ['7. Guarda el archivo y súbelo en la página de importación.'],
      [''],
      ['Columnas disponibles:'],
      ...filteredVars.map(v => [`  • ${v.replace(/_/g, ' ')}`]),
      [''],
      ['Sistema de Certificación - VERIX'],
    ]);
    instructionsWs['!cols'] = [{ wch: 70 }];
    XLSX.utils.book_append_sheet(wb, instructionsWs, 'Instrucciones');

    XLSX.writeFile(wb, `${safeName}.xlsx`);
  };

  if (loadingTemplates) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        <SkeletonCard variant="form" count={1} className="max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/requests')} className="btn-icon text-on-surface-variant hover:bg-surface-container-high rounded-xl p-2">
          <ArrowLeft size={22} />
        </button>
        <div>
          <h1 className="text-headline-lg font-headline-lg text-on-surface">
            {isEditMode ? 'Editar solicitud' : isReuseMode ? 'Reutilizar datos' : 'Nueva solicitud'}
          </h1>
          <p className="text-body-md text-on-surface-variant">
            {isEditMode ? 'Modifica los datos de la solicitud' : isReuseMode ? 'Corrige los datos y selecciona una plantilla para crear una nueva solicitud' : 'Solicita la emisión de certificados'}
          </p>
        </div>
      </div>

      {/* === STEP 1: CHOOSE TYPE (only for new, not edit) === */}
      {!isEditMode && !creationType && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setCreationType('single')}
            className="glass-card p-8 rounded-2xl text-left hover:shadow-lg hover:-translate-y-0.5 transition-all border border-white/40 group"
          >
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FileText size={28} className="text-primary" />
            </div>
            <h3 className="text-lg font-bold text-on-surface mb-2">Solicitud única</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Crea una solicitud de certificado llenando el formulario manualmente.
              Ideal para casos individuales o pruebas rápidas.
            </p>
          </button>

          <button
            onClick={() => setCreationType('multiple')}
            className="glass-card p-8 rounded-2xl text-left hover:shadow-lg hover:-translate-y-0.5 transition-all border border-white/40 group"
          >
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Upload size={28} className="text-primary" />
            </div>
            <h3 className="text-lg font-bold text-on-surface mb-2">Múltiples solicitudes</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Importa un archivo Excel con los datos de varios certificados.
              Cada fila del archivo generará una solicitud independiente.
            </p>
          </button>
        </div>
      )}

      {/* === FORM (after type is selected) === */}
      {creationType && (
        <>
          {/* Back to type selection */}
          <button
            onClick={() => {
              setCreationType(null);
              setSelectedTemplate('');
              setFormData({});
              setExcelData([]);
              setExcelColumns([]);
              setColumnMapping({});
            }}
            className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <ArrowLeft size={16} />
            Volver a seleccionar tipo
          </button>

          {/* Template selector (shared) */}
          <div className="glass-card p-6 rounded-2xl space-y-4 border border-white/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <FileText size={20} className="text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-on-surface">Plantilla</h2>
                <p className="text-sm text-on-surface-variant">
                  {templates.length === 0
                    ? 'No hay plantillas disponibles para tu institución'
                    : 'Selecciona el tipo de certificado a emitir'}
                </p>
              </div>
            </div>

            <select
              className="input w-full"
              value={selectedTemplate}
              onChange={e => handleTemplateChange(e.target.value)}
            >
              <option value="">Selecciona una plantilla...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.code ? `(${t.code})` : ''} {t.category ? `· ${t.category}` : ''}
                </option>
              ))}
            </select>

            {selectedTemplate && !loadingTemplates && (
              <div className="bg-surface-container-low rounded-lg px-4 py-3 flex items-center justify-between">
                <p className="text-sm text-on-surface-variant/70">
                  {templates.find(t => t.id === selectedTemplate)?.description || 'Sin descripción'}
                </p>
                <span className="text-xs text-on-surface-variant/50 font-mono">
                  {filteredVars.length > 0
                    ? `${filteredVars.length} campos`
                    : templateVars.length > 0
                      ? 'Solo campos del sistema'
                      : 'Sin campos'}
                </span>
              </div>
            )}
          </div>

          {/* Reuse mode banner */}
          {isReuseMode && originalRejectedId && (
            <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200/70">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-amber-800 mb-1">Reutilizando datos de solicitud rechazada</h3>
                  <p className="text-xs text-amber-700/80">
                    Los datos de la solicitud anterior se han cargado. Puedes seleccionar una plantilla diferente,
                    corregir los datos y crear una nueva solicitud.
                  </p>
                  {originalRejectionReason && (
                    <div className="mt-2 bg-white/70 rounded-xl p-3 border border-amber-100">
                      <span className="text-[10px] uppercase tracking-wider text-rose-600/70 font-bold block">Motivo del rechazo anterior</span>
                      <p className="text-sm font-medium text-rose-700 mt-0.5">{originalRejectionReason}</p>
                    </div>
                  )}
                  {/* Show original data */}
                  {Object.keys(formData).length > 0 && (
                    <details className="mt-3 group">
                      <summary className="text-xs font-semibold text-amber-700 cursor-pointer hover:text-amber-800 transition-colors select-none">
                        Ver datos originales ({Object.keys(formData).length} campos)
                      </summary>
                      <div className="mt-2 bg-white/60 rounded-xl p-3 border border-amber-100/80 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {Object.entries(formData).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-[10px] uppercase tracking-wider text-amber-600/60 font-bold block">{key.replace(/_/g, ' ')}</span>
                            <span className="font-medium text-amber-900">{value || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === SINGLE MODE === */}
          {creationType === 'single' && (
            <form onSubmit={handleIndividualSubmit} className="space-y-6">
              {selectedTemplate && filteredVars.length > 0 && (
                <div className="glass-card p-6 rounded-2xl space-y-5 border border-white/40">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <FileText size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-on-surface">Datos del certificado</h2>
                      <p className="text-sm text-on-surface-variant">Completa la información requerida</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredVars.map((variable) => (
                      <div key={variable}>
                        <label className="block text-sm font-bold text-on-surface mb-2 capitalize">
                          {variable.replace(/_/g, ' ')}
                        </label>
                        {['fecha', 'date'].includes(variable) || variable.toLowerCase().includes('fecha') ? (
                          <input
                            type="date"
                            className="input w-full"
                            value={formData[variable] || ''}
                            onChange={e => setFormData({ ...formData, [variable]: e.target.value })}
                          />
                        ) : ['horas', 'horas_', 'duracion'].includes(variable) || variable.toLowerCase().includes('hora') ? (
                          <input
                            type="number"
                            className="input w-full"
                            placeholder="Ej: 120"
                            value={formData[variable] || ''}
                            onChange={e => setFormData({ ...formData, [variable]: e.target.value })}
                          />
                        ) : ['email', 'correo', 'mail'].includes(variable) ? (
                          <input
                            type="email"
                            className="input w-full"
                            placeholder={`Ingresa ${variable.replace(/_/g, ' ')}`}
                            value={formData[variable] || ''}
                            onChange={e => setFormData({ ...formData, [variable]: e.target.value })}
                          />
                        ) : (
                          <input
                            className="input w-full"
                            placeholder={`Ingresa ${variable.replace(/_/g, ' ')}`}
                            value={formData[variable] || ''}
                            onChange={e => setFormData({ ...formData, [variable]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedTemplate && filteredVars.length === 0 && templateVars.length > 0 && (
                <div className="glass-card p-8 rounded-2xl text-center border border-white/40">
                  <CheckCircle size={40} className="mx-auto text-primary/60 mb-3" />
                  <p className="text-body-lg font-semibold text-on-surface-variant">Sin campos disponibles</p>
                  <p className="text-body-md text-on-surface-variant/60 mt-1">
                    Esta plantilla solo tiene campos del sistema (código, radicado) que se asignan automáticamente.
                  </p>
                </div>
              )}

              {!selectedTemplate && (
                <div className="glass-card p-12 rounded-2xl text-center">
                  <FileText size={48} className="mx-auto text-surface-variant mb-4" />
                  <p className="text-body-lg font-semibold text-on-surface-variant">Selecciona una plantilla</p>
                  <p className="text-body-md text-on-surface-variant/60 mt-1">Elige el tipo de certificado para comenzar</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={() => navigate('/requests')} className="btn-secondary px-6 py-3">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingIndividual || !selectedTemplate}
                  className="btn-primary px-8 py-3"
                >
                  {savingIndividual ? (
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {isEditMode ? 'Actualizando...' : 'Creando...'}
                    </span>
                  ) : (
                    <><Save size={18} /> {isEditMode ? 'Actualizar solicitud' : 'Crear solicitud'}</>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* === MASSIVE MODE === */}
          {creationType === 'multiple' && (
            <div className="space-y-6">
              {/* Upload area */}
              {excelData.length === 0 ? (
                <div className="glass-card p-8 rounded-2xl border border-dashed border-outline-variant/50">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <Upload size={32} className="text-primary" />
                    </div>
                    <h3 className="text-lg font-bold text-on-surface mb-1">{isEditMode ? 'Actualizar lote desde Excel' : 'Importar desde Excel'}</h3>
                    <p className="text-sm text-on-surface-variant mb-6 max-w-md">
                      {isEditMode
                        ? 'Sube un archivo Excel (.xlsx o .csv) con los nuevos datos. Los datos del lote se actualizarán con la información del archivo.'
                        : 'Sube un archivo Excel (.xlsx o .csv) con los datos de los certificados. Cada fila será una solicitud independiente.'}
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!selectedTemplate}
                      className="btn-primary px-8 py-3"
                    >
                      <Upload size={18} /> Seleccionar archivo
                    </button>

                    {!selectedTemplate && (
                      <p className="text-xs text-warning-500 mt-3 flex items-center gap-1">
                        <AlertCircle size={12} />
                        Selecciona primero una plantilla
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                /* Preview & mapping */
                <div className="space-y-4">
                  {/* Mapping */}
                  {filteredVars.length > 0 && (
                    <div className="glass-card p-5 rounded-2xl space-y-3 border border-white/40">
                      <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-2">
                        <AlertCircle size={14} />
                        Mapeo de columnas
                      </h3>
                      <p className="text-xs text-on-surface-variant/60">
                        Relaciona las columnas del Excel con los campos de la plantilla
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {excelColumns.map(col => (
                          <div key={col} className="flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2.5">
                            <span className="text-sm font-medium text-on-surface w-1/3 truncate">{col}</span>
                            <span className="text-on-surface-variant/40">&rarr;</span>
                            <select
                              className="text-sm bg-white border border-outline-variant/30 rounded-lg px-2 py-1.5 flex-1"
                              value={columnMapping[col] || ''}
                              onChange={e => setColumnMapping({ ...columnMapping, [col]: e.target.value })}
                            >
                              <option value="">No importar</option>
                              {filteredVars.map(v => (
                                <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preview table */}
                  <div className="glass-card rounded-2xl overflow-hidden border border-white/40">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
                      <div className="flex items-center gap-2">
                        <Table size={18} className="text-primary" />
                        <span className="font-semibold text-sm text-on-surface">
                          Vista previa ({excelData.length} filas)
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setExcelData([]);
                          setExcelColumns([]);
                          setColumnMapping({});
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="text-xs text-error hover:underline"
                      >
                        Cambiar archivo
                      </button>
                    </div>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-surface-container-low/50">
                            {excelColumns.map(col => (
                              <th key={col} className="text-left px-4 py-3 text-xs font-bold text-on-surface-variant uppercase whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {excelData.slice(0, 20).map((row, i) => (
                            <tr key={i} className="hover:bg-primary/[0.02]">
                              {excelColumns.map(col => (
                                <td key={col} className="px-4 py-2.5 text-sm text-on-surface-variant truncate max-w-[200px]">
                                  {row[col] || <span className="text-on-surface-variant/30">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {excelData.length > 20 && (
                      <div className="px-5 py-3 text-xs text-center text-on-surface-variant/50 bg-surface-container-low/30">
                        Mostrando 20 de {excelData.length} filas
                      </div>
                    )}
                  </div>

                  {/* Progress */}
                  {importing && (
                    <div className="glass-card p-5 rounded-2xl border border-primary/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-on-surface">
                          Importando...
                        </span>
                        <span className="text-sm text-on-surface-variant">
                          {importProgress.current} / {importProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-surface-container rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full transition-all duration-300"
                          style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={downloadTemplate}
                      disabled={!filteredVars.length}
                      className="btn-secondary px-4 py-2.5 text-sm"
                    >
                      <Download size={16} /> Descargar plantilla
                    </button>
                    <div className="flex items-center gap-3">
                      <button onClick={() => navigate('/requests')} className="btn-secondary px-6 py-3">
                        Cancelar
                      </button>
                      <button
                        onClick={handleImportMassive}
                        disabled={importing || excelData.length === 0}
                        className="btn-primary px-8 py-3"
                      >
                        {importing ? (
                          <span className="flex items-center gap-2">
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {isEditMode ? 'Actualizando...' : 'Importando...'}
                          </span>
                        ) : (
                          <><Upload size={18} /> {isEditMode ? `Actualizar ${excelData.length} solicitudes` : `Importar ${excelData.length} solicitudes`}</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
