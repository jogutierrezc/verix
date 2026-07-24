import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { SignaturePad } from '../../components/signature/SignaturePad';
import { authorizedSignaturesApi, userCertificatesApi } from '../../services/api';
import { User, Shield, Key, Save, Pen, ChevronRight, Info, Users, Plus, Trash2, Star, X, Upload, FileKey, ShieldCheck, AlertTriangle, Clock, CheckCircle, UserCheck } from 'lucide-react';
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
  // Signature assignment: ADMIN can assign to a specific SIGNER user
  const [assignedUserId, setAssignedUserId] = useState<string>('');
  const [signerUsers, setSignerUsers] = useState<any[]>([]);

  // Stats for the footer cards
  const [stats, setStats] = useState({ totalSigned: 0, pending: 0, p12Certificates: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

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
    loadStats();
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'signatories' && user?.id) {
      loadSignatories();
      // ADMIN can load SIGNER users for assignment
      if (user?.role === 'ADMIN' && (user as any).institution_id) {
        loadSignerUsers();
      }
    }
    if (activeTab === 'signature' && user?.id) {
      loadP12Certificate();
    }
  }, [activeTab, user?.id]);

  const loadStats = async () => {
    if (!user?.id) return;
    setStatsLoading(true);
    try {
      const instId = (user as any).institution_id;

      // Base query scoped to institution if available
      const signedQuery = supabase
        .from('certificate_requests')
        .select('*', { count: 'exact', head: true })
        .in('status', ['APPROVED', 'SIGNED']);

      const pendingQuery = supabase
        .from('certificate_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');

      if (user.role !== 'ADMIN') {
        signedQuery.eq('user_id', user.id);
        pendingQuery.eq('user_id', user.id);
      }

      const [signedRes, pendingRes, p12Res] = await Promise.all([
        signedQuery,
        pendingQuery,
        supabase
          .from('user_certificates')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('institution_id', instId || ''),
      ]);

      setStats({
        totalSigned: signedRes.count || 0,
        pending: pendingRes.count || 0,
        p12Certificates: p12Res.count || 0,
      });
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadSignatories = async () => {
    setSignatoriesLoading(true);
    try {
      const params: any = {
        institutionId: (user as any).institution_id || undefined,
      };
      // 🔒 SIGNER users can only see their OWN signatures
      if (user?.role === 'SIGNER') {
        params.userId = user.id;
      }
      const { data } = await authorizedSignaturesApi.findAll(params);
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

  const handleUpdatePassword = async (prefix: string = '') => {
    const currentPw = (document.getElementById(`${prefix}current-pw`) as HTMLInputElement)?.value;
    const newPw = (document.getElementById(`${prefix}new-pw`) as HTMLInputElement)?.value;
    const confirmPw = (document.getElementById(`${prefix}confirm-pw`) as HTMLInputElement)?.value;

    if (!currentPw || !newPw) { toast.error('Completa todos los campos'); return; }
    if (newPw !== confirmPw) { toast.error('Las contraseñas no coinciden'); return; }
    if (newPw.length < 6) { toast.error('Mínimo 6 caracteres'); return; }

    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast.success('Contraseña actualizada');
      (document.getElementById(`${prefix}current-pw`) as HTMLInputElement).value = '';
      (document.getElementById(`${prefix}new-pw`) as HTMLInputElement).value = '';
      (document.getElementById(`${prefix}confirm-pw`) as HTMLInputElement).value = '';
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  /** Loads SIGNER users in the same institution for assignment */
  const loadSignerUsers = async () => {
    try {
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('institution_id', (user as any).institution_id)
        .eq('role', 'SIGNER')
        .eq('status', 'ACTIVE')
        .order('first_name');
      setSignerUsers(data || []);
    } catch (err) {
      console.error('Error loading signer users:', err);
    }
  };

  const handleAddSignatory = async () => {
    if (!newSignatory.full_name || !newSignatory.title) {
      toast.error('Nombre y cargo son requeridos');
      return;
    }

    // ADMIN: use assigned user or current; SIGNER: always use themselves
    const targetUserId = user?.role === 'ADMIN' && assignedUserId
      ? assignedUserId
      : (user?.id || '');

    try {
      const result = await authorizedSignaturesApi.create({
        user_id: targetUserId,
        institution_id: (user as any).institution_id || '',
        title: newSignatory.title,
        full_name: newSignatory.full_name,
        document_id: newSignatory.document_id || undefined,
        is_primary: signatories.length === 0,
        is_active: true,
      });

      const assignedUser = user?.role === 'ADMIN' && assignedUserId
        ? signerUsers.find(u => u.id === assignedUserId)
        : null;
      toast.success(assignedUser
        ? `Firma asignada a ${assignedUser.first_name} ${assignedUser.last_name}`
        : 'Firmante agregado'
      );

      setShowAddModal(false);
      setAssignedUserId('');
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
  const canManageSignatories = user?.role === 'ADMIN';

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
      <div className="glass-card rounded-2xl overflow-hidden flex flex-col md:flex-row min-h-[80vh] md:min-h-[600px] border border-white/40">
        {/* Left sidebar tabs - horizontal scroll on mobile */}
        <div className="w-full md:w-64 bg-white/30 border-b md:border-b-0 md:border-r border-white/20 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <div className="flex md:flex-col p-4 gap-1 min-w-max md:min-w-0">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-body-md transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-primary text-on-primary shadow-md'
                      : 'text-on-surface-variant hover:bg-white/40 active:bg-white/60'
                  }`}
                >
                  <Icon size={20} />
                  <span className="font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right content panel */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
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

              {/* ── Change password (inline in profile) ── */}
              <div className="mt-12 pt-8 border-t border-white/20">
                <h4 className="text-headline-sm font-headline-sm text-on-surface mb-6">Cambiar Contraseña</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className="label">Contraseña actual</label>
                    <input id="profile-current-pw" className="input" type="password" placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="label">Nueva contraseña</label>
                    <input id="profile-new-pw" className="input" type="password" placeholder="Mínimo 6 caracteres" />
                  </div>
                  <div>
                    <label className="label">Confirmar</label>
                    <input id="profile-confirm-pw" className="input" type="password" placeholder="••••••••" />
                  </div>
                </div>
                <div className="flex justify-end mt-6">
                  <button
                    onClick={() => handleUpdatePassword('profile-')}
                    className="btn-primary"
                  >
                    <Key size={16} /> Actualizar contraseña
                  </button>
                </div>
                <p className="text-xs text-on-surface-variant/60 mt-3 text-right">
                  También puedes cambiar tu contraseña desde la pestaña Seguridad.
                </p>
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
                  <button onClick={() => handleUpdatePassword()} className="btn-primary">
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
                    onSave={async (url: string) => {
                      // For SIGNER users, also create/update an authorized_signature
                      // so the signature appears in the certificate approval flow
                      if (user?.role === 'SIGNER' && user?.institution_id && url) {
                        try {
                          const { data: existing } = await authorizedSignaturesApi.findAll({
                            institutionId: user.institution_id,
                            userId: user.id,
                          });

                          const personalSig = existing?.find((s: any) => s.title === 'Firma Personal');

                          if (personalSig) {
                            await authorizedSignaturesApi.update(personalSig.id, {
                              signature_image_url: url,
                              is_active: true,
                            });
                          } else {
                            await authorizedSignaturesApi.create({
                              user_id: user.id,
                              institution_id: user.institution_id,
                              title: 'Firma Personal',
                              full_name: `${user.first_name} ${user.last_name}`.trim() || 'Firmante',
                              signature_image_url: url,
                              is_primary: true,
                              is_active: true,
                            });
                          }
                        } catch (err) {
                          console.warn('⚠️ No se pudo sincronizar firma personal con autorizadas:', err);
                        }
                      }
                      refreshUser();
                    }}
                  />
                  {user?.role === 'SIGNER' && (
                    <p className="text-xs text-on-surface-variant/70 flex items-center gap-1.5">
                      <Info size={12} className="shrink-0" />
                      Tu firma personal estará disponible al aprobar certificados.
                    </p>
                  )}
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
                      <button onClick={() => { setShowAddModal(false); setAssignedUserId(''); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
                        <X size={18} className="text-on-surface-variant" />
                      </button>
                    </div>
                    <div className="p-6 space-y-4">
                      {/* ADMIN: user selector to assign signature to a specific SIGNER */}
                      {user?.role === 'ADMIN' && (
                        <div>
                          <label className="label flex items-center gap-2">
                            <UserCheck size={16} />
                            Asignar a usuario firmante
                          </label>
                          <select
                            className="input"
                            value={assignedUserId}
                            onChange={e => setAssignedUserId(e.target.value)}
                          >
                            <option value="">—— Sin asignación específica ——</option>
                            {signerUsers.map(su => (
                              <option key={su.id} value={su.id}>
                                {su.first_name} {su.last_name} ({su.email})
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-on-surface-variant/60 mt-1.5">
                            {assignedUserId
                              ? 'El firmante podrá ver y usar esta firma en sus certificados.'
                              : 'Solo el administrador podrá usar esta firma.'}
                          </p>
                        </div>
                      )}
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
                      <button onClick={() => { setShowAddModal(false); setAssignedUserId(''); }} className="btn-secondary btn-sm">Cancelar</button>
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
                            <div
                              className="w-full h-full bg-no-repeat bg-contain bg-center max-h-14"
                              style={{
                                backgroundImage: `url("${sig.signature_image_url}")`,
                                pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
                                userSelect: 'none' as React.CSSProperties['userSelect'],
                              }}
                              onContextMenu={e => e.preventDefault()}
                              draggable={false}
                            />
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

      {/* Stats preview — datos reales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Total Firmados</p>
            <p className="text-2xl font-bold">
              {statsLoading ? (
                <span className="w-8 h-6 inline-block bg-surface-container-high rounded animate-pulse" />
              ) : (
                stats.totalSigned.toLocaleString('es-CO')
              )}
            </p>
          </div>
        </div>
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-secondary-fixed rounded-full flex items-center justify-center text-secondary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Pendientes</p>
            <p className="text-2xl font-bold">
              {statsLoading ? (
                <span className="w-8 h-6 inline-block bg-surface-container-high rounded animate-pulse" />
              ) : (
                stats.pending.toLocaleString('es-CO')
              )}
            </p>
          </div>
        </div>
        <div className="glass-card p-5 rounded-xl flex items-center gap-4 border border-white/40">
          <div className="w-12 h-12 bg-tertiary-fixed rounded-full flex items-center justify-center text-tertiary">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Certificados Digitales</p>
            <p className="text-2xl font-bold">
              {statsLoading ? (
                <span className="w-8 h-6 inline-block bg-surface-container-high rounded animate-pulse" />
              ) : (
                stats.p12Certificates.toLocaleString('es-CO')
              )}
            </p>
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
