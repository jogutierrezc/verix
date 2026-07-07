import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { SignaturePad } from '../../components/signature/SignaturePad';
import { authorizedSignaturesApi, userCertificatesApi } from '../../services/api';
import { User, Shield, Key, Save, Pen, ChevronRight, Info, Users, Plus, Trash2, Star, X, Upload, FileKey, ShieldCheck, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import forge from 'node-forge';

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState('personal');
  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '' });
  const [loading, setLoading] = useState(false);

  // Authorized signatories state
  const [signatories, setSignatories] = useState<any[]>([]);
  const [signatoriesLoading, setSignatoriesLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null);
  const [newSignatory, setNewSignatory] = useState({
    full_name: '',
    title: '',
    document_id: '',
  });

  // P12 Certificate state
  const [p12Certificate, setP12Certificate] = useState<any>(null);
  const [p12Loading, setP12Loading] = useState(false);
  const [selectedP12File, setSelectedP12File] = useState<File | null>(null);
  const [p12Password, setP12Password] = useState('');
  const [parsedCertInfo, setParsedCertInfo] = useState<any>(null);
  const [p12Uploading, setP12Uploading] = useState(false);
  const [showP12Upload, setShowP12Upload] = useState(false);

  useEffect(() => {
    if (user) {
      setProfile({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone: (user as any).phone || '',
      });
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'signatories' && user?.id) {
      loadSignatories();
    }
    if (activeTab === 'signature' && user?.id) {
      loadP12Certificate();
    }
  }, [activeTab, user?.id]);

  const loadSignatories = async () => {
    setSignatoriesLoading(true);
    try {
      const { data } = await authorizedSignaturesApi.findAll({
        institutionId: (user as any).institution_id || undefined,
      });
      setSignatories(data || []);
    } catch (err: any) {
      console.error('Error loading signatories:', err);
    } finally {
      setSignatoriesLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile.first_name) { toast.error('El nombre es requerido'); return; }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone || null })
        .eq('id', user?.id);
      if (error) throw error;
      toast.success('Perfil actualizado');
      refreshUser();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    const currentPw = (document.getElementById('current-pw') as HTMLInputElement)?.value;
    const newPw = (document.getElementById('new-pw') as HTMLInputElement)?.value;
    const confirmPw = (document.getElementById('confirm-pw') as HTMLInputElement)?.value;

    if (!currentPw || !newPw) { toast.error('Completa todos los campos'); return; }
    if (newPw !== confirmPw) { toast.error('Las contraseñas no coinciden'); return; }
    if (newPw.length < 6) { toast.error('Mínimo 6 caracteres'); return; }

    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success('Contraseña actualizada');
      (document.getElementById('current-pw') as HTMLInputElement).value = '';
      (document.getElementById('new-pw') as HTMLInputElement).value = '';
      (document.getElementById('confirm-pw') as HTMLInputElement).value = '';
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddSignatory = async () => {
    if (!newSignatory.full_name || !newSignatory.title) {
      toast.error('Nombre y cargo son requeridos');
      return;
    }
    try {
      const result = await authorizedSignaturesApi.create({
        user_id: user?.id || '',
        institution_id: (user as any).institution_id || '',
        title: newSignatory.title,
        full_name: newSignatory.full_name,
        document_id: newSignatory.document_id || undefined,
        is_primary: signatories.length === 0,
      });
      toast.success('Firmante agregado');
      setShowAddModal(false);
      setNewSignatory({ full_name: '', title: '', document_id: '' });
      loadSignatories();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteSignatory = async (id: string) => {
    if (!confirm('¿Eliminar este firmante autorizado?')) return;
    try {
      await authorizedSignaturesApi.remove(id);
      toast.success('Firmante eliminado');
      loadSignatories();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ── P12 Certificate ──

  const loadP12Certificate = async () => {
    if (!user?.id) return;
    setP12Loading(true);
    try {
      const cert = await userCertificatesApi.findByUser(user.id);
      setP12Certificate(cert);
    } catch (err: any) {
      console.error('Error loading P12 certificate:', err);
    } finally {
      setP12Loading(false);
    }
  };

  /**
   * Parses a P12/PFX file using node-forge and returns certificate metadata.
   * Works entirely in the browser — compatible with Vercel static hosting.
   */
  const parseP12File = async (file: File, password: string) => {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    try {
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binary));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

      const certBagOid = forge.pki.oids.certBag || '';
      const keyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag || '';
      const rawCertBags = p12.getBags({ bagType: certBagOid });
      const rawKeyBags = p12.getBags({ bagType: keyBagOid });

      // Safely extract bag lists — node-forge types are imprecise here
      const getBagList = (bags: any, oid: string) => {
        if (!bags) return [];
        const list = bags[oid];
        return Array.isArray(list) ? list : [];
      };

      const certBagList = getBagList(rawCertBags, certBagOid);
      if (certBagList.length === 0) {
        throw new Error('No se encontró ningún certificado en el archivo P12');
      }

      const cert = certBagList[0].cert;
      if (!cert) {
        throw new Error('No se pudo extraer el certificado del archivo');
      }

      // Build subject & issuer as readable strings
      const formatName = (attrs: any[]) =>
        (attrs || []).map((a: any) => `${a.name || a.shortName || ''}=${a.value}`).join(', ');

      // Calculate SHA-256 thumbprint
      const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      const md = forge.md.sha256.create();
      md.update(derBytes);
      const thumbprint = md.digest().toHex();

      // Format thumbprint with colons
      const thumbprintFormatted = thumbprint.match(/.{1,2}/g)?.join(':').toUpperCase() || thumbprint.toUpperCase();

      const keyBagList = getBagList(rawKeyBags, keyBagOid);

      const c = cert as any;
      return {
        subject: formatName(c.subject?.attributes),
        issuer: formatName(c.issuer?.attributes),
        serialNumber: cert.serialNumber,
        validFrom: c.validity?.notBefore,
        validTo: c.validity?.notAfter,
        thumbprint: thumbprintFormatted,
        hasPrivateKey: keyBagList.length > 0,
      };
    } catch (err: any) {
      if (err.message?.includes('Invalid password') || err.message?.includes('PKCS12')) {
        throw new Error('Contraseña incorrecta o archivo inválido');
      }
      throw err;
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'p12' && ext !== 'pfx') {
      toast.error('Solo archivos .p12 o .pfx');
      e.target.value = '';
      return;
    }

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo es demasiado grande (máximo 10MB)');
      e.target.value = '';
      return;
    }

    setSelectedP12File(file);
    setParsedCertInfo(null);
  };

  const handleParseCertificate = async () => {
    if (!selectedP12File) {
      toast.error('Selecciona un archivo .p12 o .pfx');
      return;
    }
    if (!p12Password) {
      toast.error('Ingresa la contraseña del certificado');
      return;
    }

    const loadingToast = toast.loading('Analizando certificado...');
    try {
      const info = await parseP12File(selectedP12File, p12Password);
      setParsedCertInfo(info);
      toast.success('✅ Certificado analizado correctamente', { id: loadingToast });
    } catch (err: any) {
      toast.error(err.message || 'Error al analizar el certificado', { id: loadingToast });
      setParsedCertInfo(null);
    }
  };

  const handleUploadP12 = async () => {
    if (!selectedP12File || !parsedCertInfo || !user?.id) return;

    setP12Uploading(true);
    const loadingToast = toast.loading('Subiendo certificado...');
    try {
      // 1. Upload file to Storage
      const { path: storagePath } = await userCertificatesApi.uploadFile(user.id, selectedP12File);

      // 2. If there was a previous certificate, remove it and delete the file
      if (p12Certificate) {
        try {
          await userCertificatesApi.deleteFile(p12Certificate.storage_path);
          await userCertificatesApi.remove(p12Certificate.id);
        } catch { /* ignore cleanup errors */ }
      }

      // 3. Save metadata to DB
      const record = await userCertificatesApi.create({
        user_id: user.id,
        institution_id: (user as any).institution_id || '',
        storage_path: storagePath,
        original_filename: selectedP12File.name,
        thumbprint: parsedCertInfo.thumbprint,
        issuer: parsedCertInfo.issuer,
        subject: parsedCertInfo.subject,
        valid_from: parsedCertInfo.validFrom instanceof Date
          ? parsedCertInfo.validFrom.toISOString()
          : parsedCertInfo.validFrom,
        valid_to: parsedCertInfo.validTo instanceof Date
          ? parsedCertInfo.validTo.toISOString()
          : parsedCertInfo.validTo,
        serial_number: parsedCertInfo.serialNumber,
      });

      // 4. Store encrypted password via Edge Function (Fase 2)
      try {
        const { error: fnError } = await supabase.functions.invoke('store-p12-password', {
          body: { record_id: record.id, password: p12Password },
        });

        if (fnError) {
          console.error('⚠️ Error al almacenar contraseña cifrada:', fnError);
          toast.error('Certificado instalado, pero no se pudo cifrar la contraseña. La firma digital no funcionará hasta que reintentes.', { id: loadingToast });
          setP12Certificate(record);
          return;
        }
      } catch (fnErr) {
        console.error('⚠️ Error llamando a store-p12-password:', fnErr);
        toast.error('Certificado instalado, pero hubo un error al guardar la contraseña cifrada.', { id: loadingToast });
        setP12Certificate(record);
        return;
      }

      setP12Certificate(record);
      setShowP12Upload(false);
      setSelectedP12File(null);
      setP12Password('');
      setParsedCertInfo(null);
      toast.success('✅ Certificado digital instalado correctamente — firma digital lista', { id: loadingToast });
    } catch (err: any) {
      toast.error(err.message || 'Error al subir el certificado', { id: loadingToast });
    } finally {
      setP12Uploading(false);
    }
  };

  const handleRemoveP12 = async () => {
    if (!p12Certificate || !confirm('¿Eliminar este certificado digital? Las solicitudes futuras no podrán firmarse digitalmente.')) return;

    setP12Uploading(true);
    try {
      await userCertificatesApi.deleteFile(p12Certificate.storage_path);
      await userCertificatesApi.remove(p12Certificate.id);
      setP12Certificate(null);
      toast.success('Certificado eliminado');
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar');
    } finally {
      setP12Uploading(false);
    }
  };

  const isCertExpired = (cert: any) => {
    if (!cert?.valid_to) return false;
    return new Date(cert.valid_to) < new Date();
  };

  const isCertExpiringSoon = (cert: any) => {
    if (!cert?.valid_to) return false;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return new Date(cert.valid_to).getTime() - Date.now() < thirtyDays;
  };

  const handleSetPrimary = async (id: string) => {
    try {
      await authorizedSignaturesApi.update(id, { is_primary: true });
      toast.success('Firma primaria actualizada');
      loadSignatories();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const canSign = user?.role === 'SIGNER' || user?.role === 'ADMIN';
  const canManageSignatories = user?.role === 'ADMIN' || user?.role === 'SIGNER';

  const tabs = [
    { id: 'personal', icon: User, label: 'Información Personal' },
    { id: 'security', icon: Shield, label: 'Seguridad' },
    ...(canSign ? [{ id: 'signature', icon: Pen, label: 'Firma' }] : []),
    ...(canManageSignatories ? [{ id: 'signatories', icon: Users, label: 'Firmantes' }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
          <User size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-headline-lg font-headline-lg text-on-surface">Configuración</h1>
          <p className="text-body-md text-on-surface-variant">Gestiona tu identidad y credenciales criptográficas</p>
        </div>
      </div>

      {/* Glass panel with tabs */}
      <div className="glass-card rounded-2xl overflow-hidden flex flex-col md:flex-row min-h-[600px] border border-white/40">
        {/* Left sidebar tabs */}
        <div className="w-full md:w-64 bg-white/30 border-b md:border-b-0 md:border-r border-white/20 p-4 space-y-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-body-md transition-all ${
                  isActive
                    ? 'bg-primary text-on-primary shadow-md'
                    : 'text-on-surface-variant hover:bg-white/40'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right content panel */}
        <div className="flex-1 p-8 overflow-y-auto">
          {/* PERSONAL INFO */}
          {activeTab === 'personal' && (
            <section className="animate-fade-in">
              <h3 className="text-headline-md font-headline-md text-on-surface mb-8">Información Personal</h3>
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative group">
                    <div className="w-28 h-28 rounded-full bg-primary-fixed/50 flex items-center justify-center text-primary text-4xl font-bold border-4 border-white shadow-lg">
                      {user?.first_name?.charAt(0)}{user?.last_name?.charAt(0)}
                    </div>
                    <button className="absolute bottom-0 right-0 bg-primary p-2 rounded-full text-on-primary shadow-lg hover:scale-110 transition-transform">
                      <Pen size={14} />
                    </button>
                  </div>
                  <span className="text-label-sm text-on-surface-variant">Click para cambiar foto</span>
                </div>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="label">Nombre *</label>
                    <input className="input" value={profile.first_name}
                      onChange={e => setProfile({...profile, first_name: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Apellido</label>
                    <input className="input" value={profile.last_name}
                      onChange={e => setProfile({...profile, last_name: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input className="input" value={user?.email || ''} disabled />
                  </div>
                  <div>
                    <label className="label">Teléfono</label>
                    <input className="input" value={profile.phone}
                      onChange={e => setProfile({...profile, phone: e.target.value})} placeholder="+57 300 123 4567" />
                  </div>
                </div>
              </div>
              <div className="mt-10 pt-6 border-t border-white/20 flex justify-end">
                <button onClick={handleSaveProfile} disabled={loading} className="btn-primary">
                  <Save size={16} /> {loading ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </section>
          )}

          {/* SECURITY */}
          {activeTab === 'security' && (
            <section className="animate-fade-in">
              <h3 className="text-headline-md font-headline-md text-on-surface mb-8">Seguridad</h3>
              <div className="bg-white/50 border border-outline-variant rounded-xl overflow-hidden">
                <div className="p-6 flex items-center justify-between border-b border-surface-container-highest">
                  <div>
                    <p className="font-semibold text-on-surface">Autenticación de Dos Factores</p>
                    <p className="text-sm text-on-surface-variant">Recomendado para administradores institucionales</p>
                  </div>
                  <label className="toggle-switch" />
                </div>
                <div className="p-6 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-on-surface">Cambiar Contraseña</p>
                    <p className="text-sm text-on-surface-variant">Último cambio hace 42 días</p>
                  </div>
                </div>
                <div className="px-6 pb-6 space-y-4">
                  <div>
                    <label className="label">Contraseña actual</label>
                    <input id="current-pw" className="input" type="password" placeholder="••••••••" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Nueva contraseña</label>
                      <input id="new-pw" className="input" type="password" placeholder="••••••••" />
                    </div>
                    <div>
                      <label className="label">Confirmar</label>
                      <input id="confirm-pw" className="input" type="password" placeholder="••••••••" />
                    </div>
                  </div>
                  <button onClick={handleUpdatePassword} className="btn-primary">
                    <Key size={16} /> Actualizar contraseña
                  </button>
                </div>
              </div>
              <div className="mt-6 bg-primary/5 border border-primary/20 rounded-xl p-5 flex items-start gap-3">
                <Info size={20} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-primary uppercase mb-1">Nota de Seguridad</p>
                  <p className="text-sm text-on-surface-variant">Tus claves privadas están encriptadas con AES-256 y almacenadas de forma segura. VERIX nunca tiene acceso a tu contraseña en texto plano.</p>
                </div>
              </div>
            </section>
          )}

          {/* SIGNATURE */}
          {activeTab === 'signature' && (
            <section className="animate-fade-in">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h3 className="text-headline-md font-headline-md text-on-surface">Gestión de Firmas</h3>
                  <p className="text-body-md text-on-surface-variant mt-1">Configura cómo autorizas y firmas documentos.</p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Verificada
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Handwritten Signature */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-on-surface">Firma Manuscrita</h4>
                  <SignaturePad
                    userId={user?.id || ''}
                    currentSignatureUrl={(user as any).signature_url}
                    onSave={() => refreshUser()}
                  />
                </div>

                {/* Digital Certificate — P12/PFX */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-on-surface">Firma Digital (e.Firma)</h4>

                  {p12Loading ? (
                    <div className="bg-white/50 border border-outline-variant rounded-xl p-6 flex items-center justify-center">
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-on-surface-variant">Cargando certificado...</span>
                      </div>
                    </div>
                  ) : p12Certificate && !showP12Upload ? (
                    /* ── Certificate installed ── */
                    <div className="bg-white/50 border border-outline-variant rounded-xl overflow-hidden">
                      {/* Status header */}
                      <div className={`px-5 py-3 flex items-center justify-between ${
                        isCertExpired(p12Certificate)
                          ? 'bg-error-container/30 border-b border-error/20'
                          : isCertExpiringSoon(p12Certificate)
                          ? 'bg-tertiary-fixed/30 border-b border-tertiary/20'
                          : 'bg-primary/5 border-b border-primary/10'
                      }`}>
                        <div className="flex items-center gap-3">
                          {isCertExpired(p12Certificate) ? (
                            <AlertTriangle size={20} className="text-error" />
                          ) : isCertExpiringSoon(p12Certificate) ? (
                            <Clock size={20} className="text-tertiary" />
                          ) : (
                            <ShieldCheck size={20} className="text-primary" />
                          )}
                          <div>
                            <p className="font-semibold text-sm text-on-surface">
                              {isCertExpired(p12Certificate)
                                ? 'Certificado vencido'
                                : isCertExpiringSoon(p12Certificate)
                                ? 'Certificado próximo a vencer'
                                : 'Certificado activo'}
                            </p>
                            <p className="text-xs text-on-surface-variant">{p12Certificate.original_filename}</p>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase ${
                          isCertExpired(p12Certificate)
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            isCertExpired(p12Certificate) ? 'bg-error' : 'bg-primary'
                          }`} />
                          {isCertExpired(p12Certificate) ? 'Vencido' : 'Vigente'}
                        </span>
                      </div>

                      {/* Certificate details */}
                      <div className="p-5 space-y-3">
                        <div className="grid grid-cols-1 gap-2">
                          <DetailRow label="Titular" value={p12Certificate.subject} />
                          <DetailRow label="Emitido por" value={p12Certificate.issuer} />
                          <DetailRow
                            label="Válido desde"
                            value={p12Certificate.valid_from ? new Date(p12Certificate.valid_from).toLocaleDateString('es-CO') : '—'}
                          />
                          <DetailRow
                            label="Válido hasta"
                            value={p12Certificate.valid_to ? new Date(p12Certificate.valid_to).toLocaleDateString('es-CO') : '—'}
                            valueClass={isCertExpired(p12Certificate) ? 'text-error font-semibold' : ''}
                          />
                          <DetailRow label="Huella SHA-256" value={p12Certificate.thumbprint} mono />
                        </div>

                        <div className="flex items-center gap-3 pt-3 border-t border-outline-variant/20">
                          <button
                            onClick={() => setShowP12Upload(true)}
                            className="btn-secondary btn-sm"
                          >
                            <Upload size={14} /> Reemplazar
                          </button>
                          <button
                            onClick={handleRemoveP12}
                            disabled={p12Uploading}
                            className="btn-ghost btn-sm text-error hover:bg-error/5"
                          >
                            <Trash2 size={14} /> Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ── Upload / Replace form ── */
                    <div className="bg-white/50 border border-outline-variant rounded-xl overflow-hidden">
                      <div className="p-5 space-y-5">
                        <div className="flex items-start gap-4">
                          <div className="bg-primary/10 p-3 rounded-lg text-primary">
                            <FileKey size={22} />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-on-surface">Certificado P12 / PFX</p>
                            <p className="text-sm text-on-surface-variant mt-1">
                              Sube tu certificado criptográfico institucional para firmar certificados digitalmente.
                            </p>
                          </div>
                        </div>

                        {/* File picker */}
                        <div>
                          <label className="label">Archivo .p12 o .pfx</label>
                          <label className="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl p-6 cursor-pointer hover:border-primary/50 transition-all group bg-white/30">
                            <Upload size={32} className="text-outline-variant group-hover:text-primary transition-colors mb-2" />
                            <p className="text-sm font-medium text-on-surface">
                              {selectedP12File ? selectedP12File.name : 'Selecciona un archivo .p12 o .pfx'}
                            </p>
                            <p className="text-xs text-on-surface-variant mt-1">
                              {selectedP12File ? `${(selectedP12File.size / 1024).toFixed(1)} KB` : 'Máximo 10 MB'}
                            </p>
                            <input
                              type="file"
                              accept=".p12,.pfx"
                              onChange={handleFileSelect}
                              className="hidden"
                            />
                          </label>
                        </div>

                        {/* Password */}
                        <div>
                          <label className="label">Contraseña del certificado</label>
                          <div className="relative">
                            <input
                              type="password"
                              className="input w-full pr-10"
                              value={p12Password}
                              onChange={e => setP12Password(e.target.value)}
                              placeholder="Contraseña del archivo .p12/.pfx"
                            />
                            <Key size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
                          </div>
                        </div>

                        {/* Parse button */}
                        {selectedP12File && p12Password && !parsedCertInfo && (
                          <button
                            onClick={handleParseCertificate}
                            className="btn-primary w-full"
                          >
                            <ShieldCheck size={16} /> Analizar certificado
                          </button>
                        )}

                        {/* Parsed certificate info */}
                        {parsedCertInfo && (
                          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle size={16} className="text-primary" />
                              <span className="text-sm font-bold text-primary">Certificado válido</span>
                            </div>
                            <DetailRow label="Titular" value={parsedCertInfo.subject} />
                            <DetailRow label="Emitido por" value={parsedCertInfo.issuer} />
                            <DetailRow
                              label="Válido desde"
                              value={parsedCertInfo.validFrom instanceof Date
                                ? parsedCertInfo.validFrom.toLocaleDateString('es-CO')
                                : new Date(parsedCertInfo.validFrom).toLocaleDateString('es-CO')}
                            />
                            <DetailRow
                              label="Válido hasta"
                              value={parsedCertInfo.validTo instanceof Date
                                ? parsedCertInfo.validTo.toLocaleDateString('es-CO')
                                : new Date(parsedCertInfo.validTo).toLocaleDateString('es-CO')}
                              valueClass={new Date(parsedCertInfo.validTo) < new Date() ? 'text-error font-semibold' : ''}
                            />
                            <DetailRow label="Huella SHA-256" value={parsedCertInfo.thumbprint} mono />
                            <DetailRow
                              label="Clave privada"
                              value={parsedCertInfo.hasPrivateKey ? '✓ Incluida' : '✗ No encontrada'}
                              valueClass={parsedCertInfo.hasPrivateKey ? 'text-primary' : 'text-error'}
                            />

                            {!parsedCertInfo.hasPrivateKey && (
                              <div className="flex items-center gap-2 mt-2 p-2 bg-error/10 rounded-lg">
                                <AlertTriangle size={14} className="text-error shrink-0" />
                                <p className="text-xs text-error">El archivo no contiene la clave privada. No se podrá usar para firmar.</p>
                              </div>
                            )}

                            <div className="flex gap-3 pt-3">
                              <button
                                onClick={handleUploadP12}
                                disabled={p12Uploading || !parsedCertInfo.hasPrivateKey}
                                className="btn-primary flex-1"
                              >
                                {p12Uploading ? 'Instalando...' : 'Instalar certificado'}
                              </button>
                              <button
                                onClick={() => { setShowP12Upload(false); setSelectedP12File(null); setP12Password(''); setParsedCertInfo(null); }}
                                className="btn-secondary"
                                disabled={p12Uploading}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
                    <Info size={20} className="text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-primary uppercase mb-0.5">¿Cómo funciona?</p>
                      <p className="text-xs text-on-surface-variant">
                        El certificado se almacena en la nube y la contraseña se cifra con <strong className="font-semibold">AES-256-GCM</strong>.
                        Al aprobar una solicitud, el sistema firma automáticamente el PDF. La contraseña
                        solo se descifra dentro del servidor seguro, nunca en el navegador.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* AUTHORIZED SIGNATORIES */}
          {activeTab === 'signatories' && (
            <section className="animate-fade-in">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-headline-md font-headline-md text-on-surface">Firmantes Autorizados</h3>
                  <p className="text-body-md text-on-surface-variant mt-1">
                    Personas autorizadas para firmar certificados y documentos institucionales.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="btn-primary"
                >
                  <Plus size={16} /> Agregar Firmante
                </button>
              </div>

              {/* Add signatory modal */}
              {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 backdrop-blur-sm p-4 overflow-y-auto">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-scale-in my-8 border border-white/40">
                    <div className="flex items-center justify-between border-b border-outline-variant/10 px-6 py-4">
                      <h4 className="text-lg font-bold text-on-surface">Nuevo Firmante Autorizado</h4>
                      <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                        <X size={18} className="text-on-surface-variant" />
                      </button>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="label">Nombre Completo *</label>
                        <input className="input" value={newSignatory.full_name}
                          onChange={e => setNewSignatory({...newSignatory, full_name: e.target.value})}
                          placeholder="Nombre y apellido del firmante" />
                      </div>
                      <div>
                        <label className="label">Cargo *</label>
                        <input className="input" value={newSignatory.title}
                          onChange={e => setNewSignatory({...newSignatory, title: e.target.value})}
                          placeholder="Ej: Rector, Director, Secretario" />
                      </div>
                      <div>
                        <label className="label">Documento de Identidad</label>
                        <input className="input" value={newSignatory.document_id}
                          onChange={e => setNewSignatory({...newSignatory, document_id: e.target.value})}
                          placeholder="Opcional" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 border-t border-outline-variant/10 px-6 py-4">
                      <button onClick={() => setShowAddModal(false)} className="btn-secondary btn-sm">Cancelar</button>
                      <button onClick={handleAddSignatory} className="btn-primary btn-sm">
                        <Plus size={16} /> Crear Firmante
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Signatories list */}
              {signatoriesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : signatories.length === 0 ? (
                <div className="glass-card p-12 rounded-2xl text-center border border-dashed border-outline-variant">
                  <Users size={48} className="text-outline-variant mx-auto mb-4" />
                  <p className="text-body-md font-medium text-on-surface">No hay firmantes autorizados</p>
                  <p className="text-sm text-on-surface-variant mt-1">Agrega un firmante para comenzar a firmar documentos institucionales.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {signatories.map((sig) => (
                    <div key={sig.id} className="glass-card p-5 rounded-xl border border-white/40 flex flex-col md:flex-row gap-6">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                            {sig.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-on-surface flex items-center gap-2">
                              {sig.full_name}
                              {sig.is_primary && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase">
                                  <Star size={10} className="fill-primary" /> Primaria
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-on-surface-variant">{sig.title}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-on-surface-variant">
                          {sig.document_id && (
                            <span className="flex items-center gap-1">
                              <span className="font-semibold">Doc:</span> {sig.document_id}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <span className="font-semibold">Estado:</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              sig.is_active
                                ? 'bg-primary/10 text-primary'
                                : 'bg-error-container text-on-error-container'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sig.is_active ? 'bg-primary' : 'bg-error'}`} />
                              {sig.is_active ? 'Activo' : 'Inactivo'}
                            </span>
                          </span>
                          {sig.valid_until && (
                            <span className="flex items-center gap-1">
                              <span className="font-semibold">Vence:</span>
                              {new Date(sig.valid_until).toLocaleDateString()}
                            </span>
                          )}
                        </div>

                        {/* Signature upload section */}
                        <div className="pt-2">
                          {editingSignatureId === sig.id ? (
                            <div className="bg-white/50 rounded-xl p-4 border border-primary/20">
                              <div className="flex items-center justify-between mb-3">
                                <h5 className="text-xs font-bold text-primary uppercase tracking-wider">Firma del Firmante</h5>
                                <button
                                  onClick={() => setEditingSignatureId(null)}
                                  className="text-xs text-on-surface-variant hover:text-error transition-colors"
                                >
                                  Cancelar
                                </button>
                              </div>
                              <SignaturePad
                                userId={sig.user_id || user?.id || ''}
                                signatureMode="authorized"
                                authorizedSignatureId={sig.id}
                                institutionId={(user as any).institution_id || ''}
                                currentSignatureUrl={sig.signature_image_url}
                                onSave={() => {
                                  setEditingSignatureId(null);
                                  loadSignatories();
                                }}
                                title={sig.title}
                                fullName={sig.full_name}
                                documentId={sig.document_id}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingSignatureId(sig.id)}
                              className="flex items-center gap-2 text-xs text-primary font-semibold hover:bg-primary/5 py-1.5 px-3 rounded-lg transition-colors"
                            >
                              <Upload size={14} />
                              {sig.signature_image_url ? 'Cambiar firma' : 'Agregar firma'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 items-end justify-between md:min-w-[140px]">
                        {/* Signature image preview */}
                        <div className="w-full h-20 bg-white/40 rounded-lg border border-dashed border-outline-variant flex items-center justify-center overflow-hidden">
                          {sig.signature_image_url ? (
                            <img src={sig.signature_image_url} alt="Firma" className="max-h-14 object-contain" />
                          ) : (
                            <span className="text-[10px] text-on-surface-variant">Sin firma</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {!sig.is_primary && (
                            <button
                              onClick={() => handleSetPrimary(sig.id)}
                              className="text-[11px] text-primary font-semibold hover:bg-primary/5 py-1 px-2 rounded-lg transition-colors flex items-center gap-1"
                              title="Establecer como primaria"
                            >
                              <Star size={12} /> Primaria
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteSignatory(sig.id)}
                            className="text-[11px] text-error font-semibold hover:bg-error/5 py-1 px-2 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Stats preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Total Firmados</p>
            <p className="text-2xl font-bold">1,248</p>
          </div>
        </div>
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-secondary-fixed rounded-full flex items-center justify-center text-secondary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Pendientes Sinc</p>
            <p className="text-2xl font-bold">14</p>
          </div>
        </div>
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-tertiary-fixed rounded-full flex items-center justify-center text-tertiary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Nivel de Confianza</p>
            <p className="text-2xl font-bold">Tier 3</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ──

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}

function DetailRow({ label, value, mono, valueClass }: DetailRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-on-surface-variant/70 shrink-0 min-w-[100px] pt-0.5">{label}</span>
      <span
        className={`text-xs text-on-surface break-all ${mono ? 'font-mono text-[11px]' : ''} ${valueClass || ''}`}
        title={value}
      >
        {value || '—'}
      </span>
    </div>
  );
}
