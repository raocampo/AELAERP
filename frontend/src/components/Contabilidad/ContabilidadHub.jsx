import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { normalizarPeriodoMMYYYY } from '../../utils/periodo';
import { formatFechaCorta } from '../../utils/fecha';
import './ContabilidadHub.css';

const toMoney = (n) => Number(n || 0).toLocaleString('es-EC', { style: 'currency', currency: 'USD' });
const crearDetalleVacio = () => ({ cuentaId: '', descripcion: '', debe: '', haber: '' });

const ContabilidadHub = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('resumen');

  const [plan, setPlan] = useState([]);
  const [asientos, setAsientos] = useState([]);
  const [balance, setBalance] = useState(null);
  const [estadoResultados, setEstadoResultados] = useState(null);
  const [balanceGeneral, setBalanceGeneral] = useState(null);

  const [periodos, setPeriodos] = useState([]);
  const [loadingPeriodos, setLoadingPeriodos] = useState(false);
  const [periodoForm, setPeriodoForm] = useState({
    id: null,
    codigo: '',
    fechaInicio: '',
    fechaFin: '',
    estado: 'ABIERTO',
    observacion: '',
  });

  const [planLoading, setPlanLoading] = useState(false);
  const [instalandoPlanBase, setInstalandoPlanBase] = useState(false);
  const [instalandoSupercias, setInstalandoSupercias] = useState(false);
  const [planFiltros, setPlanFiltros] = useState({ q: '', tipo: '', activo: 'todos', soloMovimiento: false });

  const [importPC, setImportPC] = useState({ abierto: false, archivo: null, preview: null, loading: false, resultado: null, reemplazar: false, dragging: false });
  const [estadoPlan, setEstadoPlan] = useState(null);
  const [cuentaForm, setCuentaForm] = useState({
    id: null,
    codigo: '',
    nombre: '',
    nivel: 1,
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
    codigoPadre: '',
    aceptaMovimiento: false,
    activo: true,
  });

  const [diarioLoading, setDiarioLoading] = useState(false);
  const [diarioAsientos, setDiarioAsientos] = useState([]);
  const [diarioFiltros, setDiarioFiltros] = useState({ desde: '', hasta: '', tipo: '', q: '', cerrado: 'todos', periodo: '' });
  const [asientoCorreccionId, setAsientoCorreccionId] = useState('');
  const [asientoForm, setAsientoForm] = useState({
    id: null,
    fecha: new Date().toISOString().slice(0, 10),
    descripcion: '',
    tipo: 'MANUAL',
    referencia: '',
    detalles: [crearDetalleVacio(), crearDetalleVacio()],
  });

  const [mayorLoading, setMayorLoading] = useState(false);
  const [mayorFiltros, setMayorFiltros] = useState({ cuentaId: '', desde: '', hasta: '' });
  const [mayorDetalle, setMayorDetalle] = useState(null);
  const [mayorizacionLote, setMayorizacionLote] = useState(null);

  const [cierreLoading, setCierreLoading] = useState(false);
  const [estadosFiltros, setEstadosFiltros] = useState({ periodo: '', desde: '', hasta: '', fechaBalance: '' });
  const [consultasResumen, setConsultasResumen] = useState(null);
  const [asientoInicialForm, setAsientoInicialForm] = useState({
    periodo: '',
    fecha: new Date().toISOString().slice(0, 10),
    descripcion: '',
    detalles: [crearDetalleVacio(), crearDetalleVacio()],
  });

  const cargar = async () => {
    setLoading(true);
    try {
      const [planRes, asientosRes, balanceRes, resultadosRes, bgRes, periodosRes] = await Promise.all([
        api.get('/contabilidad/plan-cuentas'),
        api.get('/contabilidad/asientos', { params: { limit: 8 } }),
        api.get('/contabilidad/balance-comprobacion'),
        api.get('/contabilidad/estado-resultados'),
        api.get('/contabilidad/balance-general'),
        api.get('/contabilidad/periodos'),
      ]);

      setPlan(planRes.data?.data?.flat || []);
      setAsientos(asientosRes.data?.data || []);
      setBalance(balanceRes.data?.data || null);
      setEstadoResultados(resultadosRes.data?.data || null);
      setBalanceGeneral(bgRes.data?.data || null);
      setPeriodos(periodosRes.data?.data?.items || []);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar contabilidad');
    } finally {
      setLoading(false);
    }
  };

  const cargarPeriodos = useCallback(async () => {
    setLoadingPeriodos(true);
    try {
      const res = await api.get('/contabilidad/periodos');
      setPeriodos(res.data?.data?.items || []);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar períodos contables');
    } finally {
      setLoadingPeriodos(false);
    }
  }, []);

  const cargarEstadoPlan = useCallback(async () => {
    try {
      const res = await api.get('/contabilidad/plan-cuentas/estado');
      setEstadoPlan(res.data?.data || null);
    } catch {
      // no bloquea el flujo
    }
  }, []);

  const cargarPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await api.get('/contabilidad/plan-cuentas', {
        params: {
          q: planFiltros.q || undefined,
          tipo: planFiltros.tipo || undefined,
          activo: planFiltros.activo,
          soloMovimiento: planFiltros.soloMovimiento,
        },
      });
      setPlan(res.data?.data?.flat || []);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar plan de cuentas');
    } finally {
      setPlanLoading(false);
    }
  }, [planFiltros]);

  const cargarDiario = useCallback(async () => {
    setDiarioLoading(true);
    try {
      const periodo = diarioFiltros.periodo ? normalizarPeriodoMMYYYY(diarioFiltros.periodo) : '';
      const res = await api.get('/contabilidad/asientos', {
        params: {
          limit: 100,
          desde: diarioFiltros.desde || undefined,
          hasta: diarioFiltros.hasta || undefined,
          tipo: diarioFiltros.tipo || undefined,
          q: diarioFiltros.q || undefined,
          cerrado: diarioFiltros.cerrado,
          periodo: periodo || undefined,
        },
      });
      setDiarioAsientos(res.data?.data || []);
      if (periodo && periodo !== diarioFiltros.periodo) {
        setDiarioFiltros((prev) => ({ ...prev, periodo }));
      }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar libro diario');
    } finally {
      setDiarioLoading(false);
    }
  }, [diarioFiltros]);

  const cargarEstadosFinancieros = useCallback(async () => {
    setCierreLoading(true);
    try {
      const periodo = estadosFiltros.periodo ? normalizarPeriodoMMYYYY(estadosFiltros.periodo) : '';
      const paramsBase = {
        periodo: periodo || undefined,
        desde: estadosFiltros.desde || undefined,
        hasta: estadosFiltros.hasta || undefined,
      };

      const [balanceRes, resultadosRes, bgRes, consultasRes] = await Promise.all([
        api.get('/contabilidad/balance-comprobacion', { params: paramsBase }),
        api.get('/contabilidad/estado-resultados', { params: paramsBase }),
        api.get('/contabilidad/balance-general', { params: { fecha: estadosFiltros.fechaBalance || undefined } }),
        api.get('/contabilidad/consultas/resumen', { params: paramsBase }),
      ]);

      setBalance(balanceRes.data?.data || null);
      setEstadoResultados(resultadosRes.data?.data || null);
      setBalanceGeneral(bgRes.data?.data || null);
      setConsultasResumen(consultasRes.data?.data || null);
      if (periodo && periodo !== estadosFiltros.periodo) {
        setEstadosFiltros((prev) => ({ ...prev, periodo }));
      }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar estados financieros');
    } finally {
      setCierreLoading(false);
    }
  }, [estadosFiltros]);

  const cargarLibroMayor = useCallback(async () => {
    if (!mayorFiltros.cuentaId) {
      setMayorDetalle(null);
      return;
    }

    setMayorLoading(true);
    try {
      const res = await api.get(`/contabilidad/mayor/${mayorFiltros.cuentaId}`, {
        params: {
          desde: mayorFiltros.desde || undefined,
          hasta: mayorFiltros.hasta || undefined,
        },
      });
      setMayorDetalle(res.data?.data || null);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al cargar libro mayor');
    } finally {
      setMayorLoading(false);
    }
  }, [mayorFiltros]);

  const descargarReporteContable = async (tipoReporte, formato, filtros = {}) => {
    try {
      const res = await api.get(`/contabilidad/reportes/${tipoReporte}`, {
        params: {
          ...filtros,
          formato,
        },
        responseType: 'blob',
      });

      const contentDisposition = res.headers?.['content-disposition'] || '';
      const match = contentDisposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `reporte_${tipoReporte}.${formato === 'pdf' ? 'pdf' : 'csv'}`;

      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.setAttribute('download', filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);

      toast.success(`Reporte ${tipoReporte.toUpperCase()} descargado (${formato.toUpperCase()})`);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || `No se pudo descargar reporte ${tipoReporte}`);
    }
  };

  const cargarMayorizacionLote = useCallback(async () => {
    setMayorLoading(true);
    try {
      const res = await api.get('/contabilidad/mayorizacion', {
        params: {
          desde: mayorFiltros.desde || undefined,
          hasta: mayorFiltros.hasta || undefined,
        },
      });
      setMayorizacionLote(res.data?.data || null);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error en mayorización por lote');
    } finally {
      setMayorLoading(false);
    }
  }, [mayorFiltros.desde, mayorFiltros.hasta]);

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (tab === 'periodos' && periodos.length === 0) {
      cargarPeriodos();
    }
    if (tab === 'plan') {
      cargarPlan();
      cargarEstadoPlan();
    }
    if (tab === 'diario') {
      cargarDiario();
      if (plan.length === 0) {
        setPlanFiltros((prev) => ({ ...prev, soloMovimiento: true, activo: 'true' }));
      }
    }
    if (tab === 'mayor') {
      if (plan.length === 0) {
        setPlanFiltros((prev) => ({ ...prev, soloMovimiento: true, activo: 'true' }));
      }
      if (mayorFiltros.cuentaId) {
        cargarLibroMayor();
      }
      cargarMayorizacionLote();
    }
    if (tab === 'cierre') {
      cargarEstadosFinancieros();
    }
  }, [tab, periodos.length, plan.length, mayorFiltros.cuentaId, cargarPeriodos, cargarPlan, cargarEstadoPlan, cargarDiario, cargarLibroMayor, cargarMayorizacionLote, cargarEstadosFinancieros]);

  const guardarPeriodo = async (e) => {
    e.preventDefault();
    try {
      const codigoNormalizado = normalizarPeriodoMMYYYY(periodoForm.codigo);
      if (!codigoNormalizado) {
        toast.error('Código de período inválido. Use MM/YYYY, por ejemplo 03/2026');
        return;
      }

      const payload = {
        codigo: codigoNormalizado,
        fechaInicio: periodoForm.fechaInicio,
        fechaFin: periodoForm.fechaFin,
        estado: periodoForm.estado,
        observacion: periodoForm.observacion || null,
      };

      if (periodoForm.id) {
        await api.put(`/contabilidad/periodos/${periodoForm.id}`, payload);
        toast.success('Período actualizado');
      } else {
        await api.post('/contabilidad/periodos', payload);
        toast.success('Período creado');
      }

      setPeriodoForm({ id: null, codigo: '', fechaInicio: '', fechaFin: '', estado: 'ABIERTO', observacion: '' });
      await cargarPeriodos();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar el período');
    }
  };

  const editarPeriodo = (item) => {
    setPeriodoForm({
      id: item.id,
      codigo: item.codigo,
      fechaInicio: item.fechaInicio?.slice(0, 10),
      fechaFin: item.fechaFin?.slice(0, 10),
      estado: item.estado,
      observacion: item.observacion || '',
    });
  };

  const guardarCuenta = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        codigo: cuentaForm.codigo,
        nombre: cuentaForm.nombre,
        nivel: Number(cuentaForm.nivel),
        tipo: cuentaForm.tipo,
        naturaleza: cuentaForm.naturaleza,
        codigoPadre: cuentaForm.codigoPadre || null,
        aceptaMovimiento: Boolean(cuentaForm.aceptaMovimiento),
        activo: Boolean(cuentaForm.activo),
      };

      if (cuentaForm.id) {
        await api.put(`/contabilidad/plan-cuentas/${cuentaForm.id}`, payload);
        toast.success('Cuenta contable actualizada');
      } else {
        await api.post('/contabilidad/plan-cuentas', payload);
        toast.success('Cuenta contable creada');
      }

      setCuentaForm({
        id: null,
        codigo: '',
        nombre: '',
        nivel: 1,
        tipo: 'ACTIVO',
        naturaleza: 'DEBITO',
        codigoPadre: '',
        aceptaMovimiento: false,
        activo: true,
      });
      await cargarPlan();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar la cuenta contable');
    }
  };

  const editarCuenta = (cuenta) => {
    setCuentaForm({
      id: cuenta.id,
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      nivel: cuenta.nivel,
      tipo: cuenta.tipo,
      naturaleza: cuenta.naturaleza,
      codigoPadre: cuenta.codigoPadre || '',
      aceptaMovimiento: Boolean(cuenta.aceptaMovimiento),
      activo: Boolean(cuenta.activo),
    });
  };

  const eliminarCuenta = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta cuenta contable?')) return;
    try {
      await api.delete(`/contabilidad/plan-cuentas/${id}`);
      toast.success('Cuenta eliminada');
      await cargarPlan();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo eliminar la cuenta');
    }
  };

  const instalarPlanSupercias = async (overwriteExisting = false) => {
    const msg = overwriteExisting
      ? '¿Sincronizar el Plan NIIF Supercias? Se actualizarán las cuentas existentes con el mismo código.'
      : '¿Instalar el Plan NIIF Supercias (308 cuentas)? Se agregarán a las cuentas existentes.';
    if (!window.confirm(msg)) return;
    setInstalandoSupercias(true);
    try {
      const res = await api.post('/contabilidad/plan-cuentas/semilla-supercias', { overwriteExisting });
      const info = res.data?.data || {};
      toast.success(
        overwriteExisting
          ? `Plan NIIF sincronizado: ${info.creadas || 0} creadas, ${info.actualizadas || 0} actualizadas`
          : `Plan NIIF instalado: ${info.creadas || 0} cuentas creadas`,
      );
      await cargarPlan();
      await cargarEstadoPlan();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo instalar el plan NIIF Supercias');
    } finally {
      setInstalandoSupercias(false);
    }
  };

  const instalarPlanBase = async (overwriteExisting = false) => {
    setInstalandoPlanBase(true);
    try {
      const res = await api.post('/contabilidad/plan-cuentas/semilla', { overwriteExisting });
      const info = res.data?.data || {};
      toast.success(
        overwriteExisting
          ? `Plan base sincronizado: ${info.creadas || 0} creadas, ${info.actualizadas || 0} actualizadas`
          : `Plan base instalado: ${info.creadas || 0} cuentas creadas`,
      );
      await cargarPlan();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo instalar el plan de cuentas base');
    } finally {
      setInstalandoPlanBase(false);
    }
  };

  const descargarPlantillaPlan = async () => {
    try {
      const resp = await api.get('/contabilidad/plan-cuentas/plantilla', { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([resp.data]));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', 'plantilla-plan-cuentas.xlsx');
      document.body.appendChild(link); link.click(); link.remove();
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  };

  const previewImportPlan = async (archivo) => {
    if (!archivo) return;
    setImportPC((p) => ({ ...p, loading: true, preview: null, resultado: null }));
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      const { data } = await api.post('/contabilidad/plan-cuentas/importar/preview', form);
      setImportPC((p) => ({ ...p, loading: false, preview: data.data }));
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al procesar el archivo');
      setImportPC((p) => ({ ...p, loading: false }));
    }
  };

  const ejecutarImportPlan = async () => {
    if (!importPC.archivo) return;
    setImportPC((p) => ({ ...p, loading: true }));
    try {
      const form = new FormData();
      form.append('archivo', importPC.archivo);
      form.append('reemplazar', String(importPC.reemplazar));
      const { data } = await api.post('/contabilidad/plan-cuentas/importar/ejecutar', form);
      setImportPC((p) => ({ ...p, loading: false, preview: null, archivo: null, resultado: data }));
      toast.success(data.mensaje);
      await cargarPlan();
      await cargarEstadoPlan();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al importar');
      setImportPC((p) => ({ ...p, loading: false }));
    }
  };

  const limpiarAsientoForm = () => {
    setAsientoForm({
      id: null,
      fecha: new Date().toISOString().slice(0, 10),
      descripcion: '',
      tipo: 'MANUAL',
      referencia: '',
      detalles: [crearDetalleVacio(), crearDetalleVacio()],
    });
  };

  const cambiarDetalle = (index, key, value) => {
    setAsientoForm((prev) => ({
      ...prev,
      detalles: prev.detalles.map((d, i) => (i === index ? { ...d, [key]: value } : d)),
    }));
  };

  const agregarLineaDetalle = () => {
    setAsientoForm((prev) => ({ ...prev, detalles: [...prev.detalles, crearDetalleVacio()] }));
  };

  const eliminarLineaDetalle = (index) => {
    setAsientoForm((prev) => {
      if (prev.detalles.length <= 2) return prev;
      return { ...prev, detalles: prev.detalles.filter((_, i) => i !== index) };
    });
  };

  const guardarAsiento = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        fecha: asientoForm.fecha,
        descripcion: asientoForm.descripcion,
        tipo: asientoForm.tipo,
        referencia: asientoForm.referencia || null,
        detalles: asientoForm.detalles.map((d) => ({
          cuentaId: Number(d.cuentaId),
          descripcion: d.descripcion || null,
          debe: Number(d.debe || 0),
          haber: Number(d.haber || 0),
        })),
      };

      if (asientoForm.id) {
        await api.put(`/contabilidad/asientos/${asientoForm.id}`, payload);
        toast.success('Asiento actualizado');
      } else {
        await api.post('/contabilidad/asientos', payload);
        toast.success('Asiento creado');
      }

      limpiarAsientoForm();
      await cargarDiario();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar el asiento');
    }
  };

  const editarAsiento = async (id) => {
    try {
      const res = await api.get(`/contabilidad/asientos/${id}`);
      const asiento = res.data?.data;
      if (!asiento) return;

      setAsientoForm({
        id: asiento.id,
        fecha: String(asiento.fecha).slice(0, 10),
        descripcion: asiento.descripcion || '',
        tipo: asiento.tipo || 'MANUAL',
        referencia: asiento.referencia || '',
        detalles: (asiento.detalles || []).map((d) => ({
          cuentaId: d.cuentaId,
          descripcion: d.descripcion || '',
          debe: Number(d.debe || 0),
          haber: Number(d.haber || 0),
        })),
      });
      setTab('diario');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo cargar el asiento para edición');
    }
  };

  const cerrarAsiento = async (id) => {
    if (!window.confirm('¿Deseas cerrar este asiento?')) return;
    try {
      await api.post(`/contabilidad/asientos/${id}/cerrar`);
      toast.success('Asiento cerrado');
      await cargarDiario();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo cerrar el asiento');
    }
  };

  const bloquearAsiento = async (id) => {
    if (!window.confirm('¿Bloquear este asiento? Solo el Contador o Administrador podrá modificarlo.')) return;
    try {
      await api.post(`/contabilidad/asientos/${id}/bloquear`);
      toast.success('Asiento bloqueado 🔒');
      await cargarDiario();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo bloquear el asiento');
    }
  };

  const desbloquearAsiento = async (id) => {
    if (!window.confirm('¿Desbloquear este asiento?')) return;
    try {
      await api.post(`/contabilidad/asientos/${id}/desbloquear`);
      toast.success('Asiento desbloqueado 🔓');
      await cargarDiario();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo desbloquear el asiento');
    }
  };

  const anularAsiento = async (id) => {
    if (!window.confirm('¿Deseas anular este asiento? Se creará un reverso automático.')) return;
    try {
      await api.post(`/contabilidad/asientos/${id}/anular`, { fecha: new Date().toISOString().slice(0, 10) });
      toast.success('Asiento anulado');
      await cargarDiario();
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo anular el asiento');
    }
  };

  const cambiarDetalleAsientoInicial = (index, key, value) => {
    setAsientoInicialForm((prev) => ({
      ...prev,
      detalles: prev.detalles.map((d, i) => (i === index ? { ...d, [key]: value } : d)),
    }));
  };

  const agregarLineaInicial = () => {
    setAsientoInicialForm((prev) => ({ ...prev, detalles: [...prev.detalles, crearDetalleVacio()] }));
  };

  const quitarLineaInicial = (index) => {
    setAsientoInicialForm((prev) => {
      if (prev.detalles.length <= 2) return prev;
      return { ...prev, detalles: prev.detalles.filter((_, i) => i !== index) };
    });
  };

  const guardarAsientoInicial = async (e) => {
    e.preventDefault();
    try {
      const periodo = asientoInicialForm.periodo ? normalizarPeriodoMMYYYY(asientoInicialForm.periodo) : '';
      if (asientoInicialForm.periodo && !periodo) {
        toast.error('Período inválido. Use MM/YYYY, por ejemplo 03/2026');
        return;
      }

      const payload = {
        periodo: periodo || undefined,
        fecha: asientoInicialForm.fecha,
        descripcion: asientoInicialForm.descripcion || undefined,
        detalles: asientoInicialForm.detalles.map((d) => ({
          cuentaId: Number(d.cuentaId),
          descripcion: d.descripcion || null,
          debe: Number(d.debe || 0),
          haber: Number(d.haber || 0),
        })),
      };

      await api.post('/contabilidad/asiento-inicial', payload);
      toast.success('Asiento inicial registrado');
      setAsientoInicialForm({
        periodo: '',
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: '',
        detalles: [crearDetalleVacio(), crearDetalleVacio()],
      });
      await cargarDiario();
      await cargarEstadosFinancieros();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar asiento inicial');
    }
  };

  const totalDebeInicial = asientoInicialForm.detalles.reduce((acc, d) => acc + Number(d.debe || 0), 0);
  const totalHaberInicial = asientoInicialForm.detalles.reduce((acc, d) => acc + Number(d.haber || 0), 0);

  const totalDebeForm = asientoForm.detalles.reduce((acc, d) => acc + Number(d.debe || 0), 0);
  const totalHaberForm = asientoForm.detalles.reduce((acc, d) => acc + Number(d.haber || 0), 0);
  const cuentasMovimiento = plan.filter((c) => c.aceptaMovimiento && c.activo);
  const asientosCorregibles = diarioAsientos.filter((a) => (a.tipo === 'MANUAL' || a.tipo === 'AJUSTE') && !a.cerrado);
  const hayPlanBase = plan.length > 0;

  return (
    <div className="conta-container">
      <div className="conta-header">
        <div>
          <h1>📘 Contabilidad</h1>
          <p>Módulo contable central con períodos, plan de cuentas, asientos y estados financieros.</p>
        </div>
        <div className="conta-actions">
          <button className="btn-secondary" onClick={() => navigate('/finanzas')}>Ir a Finanzas</button>
          <button className="btn-secondary" onClick={() => navigate('/reportes-tributarios')}>Reportes tributarios</button>
          <button className="btn-primary" onClick={cargar}>Actualizar</button>
        </div>
      </div>

      <div className="conta-tabs">
        <button className={tab === 'resumen' ? 'active' : ''} onClick={() => setTab('resumen')}>Resumen</button>
        <button className={tab === 'diario' ? 'active' : ''} onClick={() => setTab('diario')}>Libro Diario / Corrección</button>
        <button className={tab === 'mayor' ? 'active' : ''} onClick={() => setTab('mayor')}>Libro Mayor</button>
        <button className={tab === 'cierre' ? 'active' : ''} onClick={() => setTab('cierre')}>Cierre y Estados</button>
        <button className={tab === 'periodos' ? 'active' : ''} onClick={() => setTab('periodos')}>Períodos Contables</button>
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Plan de Cuentas</button>
      </div>

      {tab === 'resumen' && (loading ? (
        <div className="conta-loading">Cargando contabilidad...</div>
      ) : (
        <>
          <div className="conta-kpis">
            <div className="conta-kpi"><span>Plan de cuentas</span><strong>{plan.length}</strong></div>
            <div className="conta-kpi"><span>Períodos abiertos</span><strong>{periodos.filter((p) => p.estado === 'ABIERTO').length}</strong></div>
            <div className="conta-kpi"><span>Total asientos</span><strong>{asientos.length}</strong></div>
            <div className="conta-kpi"><span>Balance Debe</span><strong>{toMoney(balance?.resumen?.totalDebe)}</strong></div>
            <div className="conta-kpi"><span>Balance Haber</span><strong>{toMoney(balance?.resumen?.totalHaber)}</strong></div>
            <div className="conta-kpi"><span>Utilidad periodo</span><strong>{toMoney(estadoResultados?.utilidad)}</strong></div>
            <div className="conta-kpi"><span>Total activos</span><strong>{toMoney(balanceGeneral?.totalActivos)}</strong></div>
          </div>

          <div className="conta-grid">
            <div className="conta-card">
              <h3>Asientos recientes</h3>
              <table className="conta-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {asientos.map((a) => (
                    <tr key={a.id}>
                      <td>{a.numero}</td>
                      <td>{formatFechaCorta(a.fecha)}</td>
                      <td>{a.tipo}</td>
                      <td>{a.descripcion}</td>
                    </tr>
                  ))}
                  {asientos.length === 0 && (
                    <tr><td colSpan="4" className="conta-empty">Aún no hay asientos contables.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="conta-card">
              <h3>Estado de resultados</h3>
              <div className="conta-mini-list">
                <div><span>Ingresos</span><strong>{toMoney(estadoResultados?.totalIngresos)}</strong></div>
                <div><span>Gastos</span><strong>{toMoney(estadoResultados?.totalGastos)}</strong></div>
                <div><span>Costos</span><strong>{toMoney(estadoResultados?.totalCostos)}</strong></div>
                <div><span>Utilidad</span><strong>{toMoney(estadoResultados?.utilidad)}</strong></div>
                <div><span>Balance general</span><strong>{balanceGeneral?.balanceado ? 'Balanceado' : 'Revisar'}</strong></div>
              </div>
            </div>
          </div>
        </>
      ))}

      {tab === 'diario' && (
        <div className="conta-tab-body">
          <div className="conta-card">
            <h3>Corrección de asientos contables</h3>
            <div className="conta-filters">
              <select value={asientoCorreccionId} onChange={(e) => setAsientoCorreccionId(e.target.value)}>
                <option value="">Seleccione asiento abierto (MANUAL/AJUSTE)...</option>
                {asientosCorregibles.map((a) => (
                  <option key={a.id} value={a.id}>
                    #{a.numero} | {formatFechaCorta(a.fecha)} | {a.tipo} | {a.descripcion}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                type="button"
                onClick={() => asientoCorreccionId && editarAsiento(Number(asientoCorreccionId))}
                disabled={!asientoCorreccionId}
              >
                Cargar en formulario de corrección
              </button>
            </div>
            {asientosCorregibles.length === 0 && (
              <div className="conta-empty">No hay asientos abiertos MANUAL/AJUSTE disponibles para corrección.</div>
            )}
          </div>

          <div className="conta-card">
            <h3>{asientoForm.id ? `Formulario de corrección del asiento #${asientoForm.id}` : 'Nuevo asiento contable'}</h3>
            <form onSubmit={guardarAsiento}>
              <div className="conta-form-grid">
                <div>
                  <label>Fecha</label>
                  <input type="date" value={asientoForm.fecha} onChange={(e) => setAsientoForm((prev) => ({ ...prev, fecha: e.target.value }))} required />
                </div>
                <div>
                  <label>Tipo</label>
                  <select value={asientoForm.tipo} onChange={(e) => setAsientoForm((prev) => ({ ...prev, tipo: e.target.value }))}>
                    <option value="MANUAL">MANUAL</option>
                    <option value="AJUSTE">AJUSTE</option>
                  </select>
                </div>
                <div>
                  <label>Referencia</label>
                  <input value={asientoForm.referencia} onChange={(e) => setAsientoForm((prev) => ({ ...prev, referencia: e.target.value }))} />
                </div>
                <div className="full-width">
                  <label>Descripción</label>
                  <input value={asientoForm.descripcion} onChange={(e) => setAsientoForm((prev) => ({ ...prev, descripcion: e.target.value }))} required />
                </div>
              </div>

              <div className="conta-detail-box">
                <table className="conta-table">
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Descripción</th>
                      <th>Debe</th>
                      <th>Haber</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {asientoForm.detalles.map((detalle, index) => (
                      <tr key={`det-${index}`}>
                        <td>
                          <select value={detalle.cuentaId} onChange={(e) => cambiarDetalle(index, 'cuentaId', e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {cuentasMovimiento.map((c) => (
                              <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input value={detalle.descripcion} onChange={(e) => cambiarDetalle(index, 'descripcion', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={detalle.debe} onChange={(e) => cambiarDetalle(index, 'debe', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={detalle.haber} onChange={(e) => cambiarDetalle(index, 'haber', e.target.value)} />
                        </td>
                        <td>
                          <button type="button" className="btn-link danger" onClick={() => eliminarLineaDetalle(index)}>Quitar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="conta-form-actions">
                  <button type="button" className="btn-secondary" onClick={agregarLineaDetalle}>+ Línea</button>
                  <span className={`conta-balance ${Number(totalDebeForm.toFixed(2)) === Number(totalHaberForm.toFixed(2)) ? 'ok' : 'warn'}`}>
                    Debe: {toMoney(totalDebeForm)} | Haber: {toMoney(totalHaberForm)}
                  </span>
                </div>
                <div className="conta-form-actions">
                  <button type="submit" className="btn-primary">{asientoForm.id ? 'Actualizar asiento' : 'Crear asiento'}</button>
                  <button type="button" className="btn-secondary" onClick={limpiarAsientoForm}>Limpiar</button>
                </div>
              </div>
            </form>
          </div>

          <div className="conta-card">
            <h3>Libro diario</h3>
            <div className="conta-filters">
              <input
                placeholder="Buscar descripción/referencia"
                value={diarioFiltros.q}
                onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, q: e.target.value }))}
              />
              <input
                placeholder="Período MM/YYYY"
                value={diarioFiltros.periodo}
                onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, periodo: e.target.value }))}
                onBlur={() => {
                  const normalizado = normalizarPeriodoMMYYYY(diarioFiltros.periodo);
                  if (normalizado) {
                    setDiarioFiltros((prev) => ({ ...prev, periodo: normalizado }));
                  }
                }}
              />
              <input type="date" value={diarioFiltros.desde} onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, desde: e.target.value }))} />
              <input type="date" value={diarioFiltros.hasta} onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, hasta: e.target.value }))} />
              <select value={diarioFiltros.tipo} onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, tipo: e.target.value }))}>
                <option value="">Todos los tipos</option>
                <option value="MANUAL">MANUAL</option>
                <option value="AJUSTE">AJUSTE</option>
                <option value="FACTURA">FACTURA</option>
                <option value="COMPRA">COMPRA</option>
                <option value="CAJA">CAJA</option>
                <option value="NOMINA">NOMINA</option>
                <option value="ANULACION">ANULACION</option>
              </select>
              <select value={diarioFiltros.cerrado} onChange={(e) => setDiarioFiltros((prev) => ({ ...prev, cerrado: e.target.value }))}>
                <option value="todos">Todos</option>
                <option value="false">Abiertos</option>
                <option value="true">Cerrados</option>
              </select>
              <button className="btn-secondary" onClick={cargarDiario}>Filtrar</button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('diario', 'csv', diarioFiltros)}
              >
                Exportar Excel (CSV)
              </button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('diario', 'pdf', diarioFiltros)}
              >
                PDF Servidor
              </button>
            </div>
            {diarioLoading ? (
              <div className="conta-loading">Cargando libro diario...</div>
            ) : (
              <table className="conta-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th>Debe</th>
                    <th>Haber</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {diarioAsientos.map((a) => (
                    <tr key={a.id}>
                      <td>{a.numero}</td>
                      <td>{formatFechaCorta(a.fecha)}</td>
                      <td>{a.tipo}</td>
                      <td>{a.descripcion}</td>
                      <td>{toMoney(a.totalDebe)}</td>
                      <td>{toMoney(a.totalHaber)}</td>
                      <td>
                        {a.bloqueado
                          ? <span title="Bloqueado">🔒 BLOQUEADO</span>
                          : (a.cerrado ? 'CERRADO' : 'ABIERTO')
                        }
                      </td>
                      <td>
                        {(a.tipo === 'MANUAL' || a.tipo === 'AJUSTE') && !a.cerrado && !a.bloqueado && (
                          <button className="btn-link" onClick={() => editarAsiento(a.id)}>Editar</button>
                        )}
                        {!a.cerrado && (
                          <button className="btn-link" onClick={() => cerrarAsiento(a.id)}>Cerrar</button>
                        )}
                        {!a.bloqueado && (
                          <button className="btn-link" title="Bloquear asiento" onClick={() => bloquearAsiento(a.id)}>🔒</button>
                        )}
                        {a.bloqueado && (
                          <button className="btn-link" title="Desbloquear asiento" onClick={() => desbloquearAsiento(a.id)}>🔓</button>
                        )}
                        {a.tipo !== 'ANULACION' && (
                          <button className="btn-link danger" onClick={() => anularAsiento(a.id)}>Anular</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {diarioAsientos.length === 0 && (
                    <tr><td colSpan="8" className="conta-empty">No hay asientos para el filtro aplicado.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'periodos' && (
        <div className="conta-tab-body">
          <div className="conta-card">
            <h3>{periodoForm.id ? 'Editar período contable' : 'Nuevo período contable'}</h3>
            <form className="conta-form-grid" onSubmit={guardarPeriodo}>
              <div>
                <label>Código (MM/YYYY)</label>
                <input
                  value={periodoForm.codigo}
                  onChange={(e) => setPeriodoForm((prev) => ({ ...prev, codigo: e.target.value }))}
                  onBlur={() => {
                    const normalizado = normalizarPeriodoMMYYYY(periodoForm.codigo);
                    if (normalizado) {
                      setPeriodoForm((prev) => ({ ...prev, codigo: normalizado }));
                    }
                  }}
                  required
                />
              </div>
              <div>
                <label>Estado</label>
                <select value={periodoForm.estado} onChange={(e) => setPeriodoForm((prev) => ({ ...prev, estado: e.target.value }))}>
                  <option value="ABIERTO">ABIERTO</option>
                  <option value="CERRADO">CERRADO</option>
                </select>
              </div>
              <div>
                <label>Fecha inicio</label>
                <input type="date" value={periodoForm.fechaInicio} onChange={(e) => setPeriodoForm((prev) => ({ ...prev, fechaInicio: e.target.value }))} required />
              </div>
              <div>
                <label>Fecha fin</label>
                <input type="date" value={periodoForm.fechaFin} onChange={(e) => setPeriodoForm((prev) => ({ ...prev, fechaFin: e.target.value }))} required />
              </div>
              <div className="full-width">
                <label>Observación</label>
                <input value={periodoForm.observacion} onChange={(e) => setPeriodoForm((prev) => ({ ...prev, observacion: e.target.value }))} />
              </div>
              <div className="conta-form-actions full-width">
                <button type="submit" className="btn-primary">{periodoForm.id ? 'Actualizar período' : 'Crear período'}</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeriodoForm({ id: null, codigo: '', fechaInicio: '', fechaFin: '', estado: 'ABIERTO', observacion: '' })}
                >
                  Limpiar
                </button>
                <button type="button" className="btn-secondary" onClick={cargarPeriodos}>Recargar</button>
              </div>
            </form>
          </div>

          <div className="conta-card">
            <h3>Períodos registrados</h3>
            {loadingPeriodos ? (
              <div className="conta-loading">Cargando períodos...</div>
            ) : (
              <table className="conta-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {periodos.map((item) => (
                    <tr key={item.id}>
                      <td>{item.codigo}</td>
                      <td>{formatFechaCorta(item.fechaInicio)}</td>
                      <td>{formatFechaCorta(item.fechaFin)}</td>
                      <td>
                        <span className={`conta-badge ${item.estado === 'ABIERTO' ? 'ok' : 'warn'}`}>{item.estado}</span>
                      </td>
                      <td>
                        <button className="btn-link" onClick={() => editarPeriodo(item)}>Editar</button>
                      </td>
                    </tr>
                  ))}
                  {periodos.length === 0 && (
                    <tr><td colSpan="5" className="conta-empty">No hay períodos contables registrados.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'mayor' && (
        <div className="conta-tab-body">
          <div className="conta-card">
            <h3>Consulta de libro mayor</h3>
            <div className="conta-filters">
              <select value={mayorFiltros.cuentaId} onChange={(e) => setMayorFiltros((prev) => ({ ...prev, cuentaId: e.target.value }))}>
                <option value="">Seleccione cuenta...</option>
                {cuentasMovimiento.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                ))}
              </select>
              <input type="date" value={mayorFiltros.desde} onChange={(e) => setMayorFiltros((prev) => ({ ...prev, desde: e.target.value }))} />
              <input type="date" value={mayorFiltros.hasta} onChange={(e) => setMayorFiltros((prev) => ({ ...prev, hasta: e.target.value }))} />
              <div></div>
              <button className="btn-secondary" onClick={cargarLibroMayor}>Consultar</button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('mayor', 'csv', mayorFiltros)}
              >
                Exportar Excel (CSV)
              </button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('mayor', 'pdf', mayorFiltros)}
              >
                PDF Servidor
              </button>
            </div>

            {mayorLoading ? (
              <div className="conta-loading">Cargando libro mayor...</div>
            ) : mayorDetalle ? (
              <>
                <div className="conta-kpis conta-kpis-compact">
                  <div className="conta-kpi"><span>Cuenta</span><strong>{mayorDetalle.cuenta?.codigo}</strong></div>
                  <div className="conta-kpi"><span>Movimientos</span><strong>{mayorDetalle.movimientos?.length || 0}</strong></div>
                  <div className="conta-kpi"><span>Saldo final</span><strong>{toMoney(mayorDetalle.saldoFinal)}</strong></div>
                </div>
                <table className="conta-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Asiento</th>
                      <th>Tipo</th>
                      <th>Detalle</th>
                      <th>Debe</th>
                      <th>Haber</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mayorDetalle.movimientos || []).map((m) => (
                      <tr key={m.id}>
                        <td>{formatFechaCorta(m.fecha)}</td>
                        <td>{m.numero}</td>
                        <td>{m.tipo}</td>
                        <td>{m.descripcionDetalle || m.descripcionAsiento}</td>
                        <td>{toMoney(m.debe)}</td>
                        <td>{toMoney(m.haber)}</td>
                        <td>{toMoney(m.saldo)}</td>
                      </tr>
                    ))}
                    {(mayorDetalle.movimientos || []).length === 0 && (
                      <tr><td colSpan="7" className="conta-empty">Sin movimientos en el rango seleccionado.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="conta-empty">Seleccione una cuenta y consulte su mayor.</div>
            )}
          </div>

          <div className="conta-card">
            <h3>Mayorización por lote</h3>
            <div className="conta-form-actions">
              <button className="btn-secondary" onClick={cargarMayorizacionLote}>Procesar mayorización</button>
            </div>

            {mayorLoading ? (
              <div className="conta-loading">Procesando mayorización...</div>
            ) : mayorizacionLote ? (
              <>
                <div className="conta-kpis conta-kpis-compact">
                  <div className="conta-kpi"><span>Cuentas</span><strong>{mayorizacionLote.resumen?.cuentas || 0}</strong></div>
                  <div className="conta-kpi"><span>Movimientos</span><strong>{mayorizacionLote.resumen?.movimientos || 0}</strong></div>
                  <div className="conta-kpi"><span>Total Debe</span><strong>{toMoney(mayorizacionLote.resumen?.totalDebe)}</strong></div>
                  <div className="conta-kpi"><span>Total Haber</span><strong>{toMoney(mayorizacionLote.resumen?.totalHaber)}</strong></div>
                </div>

                <table className="conta-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Cuenta</th>
                      <th>Tipo</th>
                      <th>Movimientos</th>
                      <th>Debe</th>
                      <th>Haber</th>
                      <th>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mayorizacionLote.tabla || []).map((row) => (
                      <tr key={row.cuentaId}>
                        <td>{row.codigo}</td>
                        <td>{row.nombre}</td>
                        <td>{row.tipo}</td>
                        <td>{row.movimientos}</td>
                        <td>{toMoney(row.totalDebe)}</td>
                        <td>{toMoney(row.totalHaber)}</td>
                        <td>{toMoney(row.saldo)}</td>
                      </tr>
                    ))}
                    {(mayorizacionLote.tabla || []).length === 0 && (
                      <tr><td colSpan="7" className="conta-empty">No existen movimientos para mayorización en el rango.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="conta-empty">Ejecute la mayorización para ver el resumen por cuentas.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'plan' && (
        <div className="conta-tab-body">
          <div className="conta-card">
            <h3>{cuentaForm.id ? 'Editar cuenta contable' : 'Nueva cuenta contable'}</h3>
            <form className="conta-form-grid" onSubmit={guardarCuenta}>
              <div>
                <label>Código</label>
                <input value={cuentaForm.codigo} onChange={(e) => setCuentaForm((prev) => ({ ...prev, codigo: e.target.value }))} required />
              </div>
              <div>
                <label>Nombre</label>
                <input value={cuentaForm.nombre} onChange={(e) => setCuentaForm((prev) => ({ ...prev, nombre: e.target.value }))} required />
              </div>
              <div>
                <label>Nivel</label>
                <input type="number" min="1" value={cuentaForm.nivel} onChange={(e) => setCuentaForm((prev) => ({ ...prev, nivel: e.target.value }))} required />
              </div>
              <div>
                <label>Tipo</label>
                <select value={cuentaForm.tipo} onChange={(e) => setCuentaForm((prev) => ({ ...prev, tipo: e.target.value }))}>
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="PASIVO">PASIVO</option>
                  <option value="PATRIMONIO">PATRIMONIO</option>
                  <option value="INGRESO">INGRESO</option>
                  <option value="GASTO">GASTO</option>
                  <option value="COSTO">COSTO</option>
                </select>
              </div>
              <div>
                <label>Naturaleza</label>
                <select value={cuentaForm.naturaleza} onChange={(e) => setCuentaForm((prev) => ({ ...prev, naturaleza: e.target.value }))}>
                  <option value="DEBITO">DEBITO</option>
                  <option value="CREDITO">CREDITO</option>
                </select>
              </div>
              <div>
                <label>Código padre (opcional)</label>
                <input value={cuentaForm.codigoPadre} onChange={(e) => setCuentaForm((prev) => ({ ...prev, codigoPadre: e.target.value }))} />
              </div>
              <div className="conta-check-row">
                <label><input type="checkbox" checked={cuentaForm.aceptaMovimiento} onChange={(e) => setCuentaForm((prev) => ({ ...prev, aceptaMovimiento: e.target.checked }))} /> Acepta movimiento</label>
                <label><input type="checkbox" checked={cuentaForm.activo} onChange={(e) => setCuentaForm((prev) => ({ ...prev, activo: e.target.checked }))} /> Activa</label>
              </div>
              <div className="conta-form-actions full-width">
                <button type="submit" className="btn-primary">{cuentaForm.id ? 'Actualizar cuenta' : 'Crear cuenta'}</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCuentaForm({ id: null, codigo: '', nombre: '', nivel: 1, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '', aceptaMovimiento: false, activo: true })}
                >
                  Limpiar
                </button>
              </div>
            </form>
          </div>

          {/* ── Card: Importar plan de cuentas desde Excel ─────────────── */}
          <div className="conta-card">
            <div className="conta-import-header">
              <div>
                <h3>Importar plan de cuentas desde Excel</h3>
                <p className="conta-import-sub">Carga masiva desde otro sistema o usando la plantilla descargable</p>
              </div>
              <div className="conta-import-header-btns">
                <button className="btn-secondary" onClick={descargarPlantillaPlan}>
                  ⬇ Descargar plantilla
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setImportPC((p) => ({ ...p, abierto: !p.abierto, preview: null, resultado: null, archivo: null }))}
                >
                  {importPC.abierto ? 'Cerrar' : 'Abrir importador'}
                </button>
              </div>
            </div>

            {importPC.abierto && (
              <div className="conta-import-body">
                {/* Banner contextual: estado del sistema */}
                {estadoPlan && (
                  <div className={`conta-import-banner ${estadoPlan.planVacio ? 'banner-inicio' : estadoPlan.tieneMovimientos ? 'banner-uso' : 'banner-vacio'}`}>
                    {estadoPlan.planVacio ? (
                      <>
                        <strong>Inicio desde cero</strong> — Esta empresa aún no tiene plan de cuentas.
                        Puede importar el plan completo desde Excel o usar el plan base AELA.
                        Se recomienda usar el modo <em>Reemplazar plan completo</em>.
                      </>
                    ) : estadoPlan.tieneMovimientos ? (
                      <>
                        <strong>Sistema en operación</strong> — El plan tiene {estadoPlan.totalCuentas} cuentas y {estadoPlan.totalAsientos} asientos contables.
                        Solo podrá agregar cuentas nuevas o eliminar las que no tengan movimientos.
                      </>
                    ) : (
                      <>
                        <strong>Plan sin movimientos</strong> — El plan tiene {estadoPlan.totalCuentas} cuentas pero aún no hay asientos contables.
                        Puede reemplazar el plan completo sin restricciones.
                      </>
                    )}
                  </div>
                )}

                {/* Paso 1: seleccionar archivo */}
                {!importPC.preview && !importPC.resultado && (
                  <div className="conta-import-upload">
                    <p className="conta-import-instruccion">
                      1. Descarga la plantilla, llena el plan y vuelve a subir el archivo .xlsx
                    </p>
                    <label
                      className={`conta-dropzone${importPC.dragging ? ' dragging' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setImportPC((p) => ({ ...p, dragging: true })); }}
                      onDragEnter={(e) => { e.preventDefault(); setImportPC((p) => ({ ...p, dragging: true })); }}
                      onDragLeave={(e) => {
                        // Solo quitar el estado si el cursor salió del label completo
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setImportPC((p) => ({ ...p, dragging: false }));
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setImportPC((p) => ({ ...p, dragging: false }));
                        const f = e.dataTransfer.files[0];
                        if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
                          setImportPC((p) => ({ ...p, archivo: f }));
                          previewImportPlan(f);
                        } else if (f) {
                          toast.error('Solo se aceptan archivos .xlsx o .xls');
                        }
                      }}
                    >
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files[0];
                          if (f) {
                            setImportPC((p) => ({ ...p, archivo: f }));
                            previewImportPlan(f);
                          }
                          e.target.value = '';
                        }}
                      />
                      <span className="conta-dropzone-icon">{importPC.dragging ? '📥' : '📂'}</span>
                      <span>
                        {importPC.loading
                          ? 'Procesando…'
                          : importPC.dragging
                            ? 'Suelta el archivo aquí'
                            : 'Arrastra tu archivo aquí o haz clic para buscar'}
                      </span>
                      <span className="conta-dropzone-hint">.xlsx · .xls</span>
                      {importPC.archivo && !importPC.loading && !importPC.dragging && (
                        <span className="conta-dropzone-fname">{importPC.archivo.name}</span>
                      )}
                    </label>
                  </div>
                )}

                {/* Loading */}
                {importPC.loading && (
                  <div className="conta-loading">Validando el archivo…</div>
                )}

                {/* Paso 2: vista previa */}
                {importPC.preview && !importPC.loading && (
                  <div className="conta-import-preview">
                    <div className="conta-import-resumen">
                      <span className="badge-ok">✓ {importPC.preview.validos} válidas</span>
                      {importPC.preview.errores > 0 && (
                        <span className="badge-error">✗ {importPC.preview.errores} con error</span>
                      )}
                      <span className="badge-total">Total: {importPC.preview.total} filas</span>
                    </div>

                    {/* Diagnóstico cuando todas las filas fallan — columnas no reconocidas */}
                    {importPC.preview.validos === 0 && importPC.preview.errores > 0 && (
                      <div className="conta-import-diag">
                        <strong>No se reconocieron las columnas del archivo.</strong>
                        {importPC.preview.columnas?.length > 0 && (
                          <span> Columnas detectadas en tu Excel: <em>{importPC.preview.columnas.join(' · ')}</em></span>
                        )}
                        <br />
                        Columnas esperadas: <code>codigo</code>, <code>nombre</code>, <code>tipo</code> (ACTIVO | PASIVO | PATRIMONIO | INGRESO | GASTO | COSTO).
                        {' '}Descarga la plantilla para ver el formato exacto.
                      </div>
                    )}

                    {/* Opción reemplazar */}
                    {estadoPlan && !estadoPlan.planVacio && (
                      <div className={`conta-import-reemplazar ${importPC.reemplazar ? 'activo' : ''}`}>
                        <label className="conta-check-row">
                          <input
                            type="checkbox"
                            checked={importPC.reemplazar}
                            onChange={(e) => setImportPC((p) => ({ ...p, reemplazar: e.target.checked }))}
                          />
                          <strong>Reemplazar plan completo</strong>
                          {' '}— las cuentas del plan actual que NO estén en este Excel serán eliminadas
                          {estadoPlan.tieneMovimientos && (
                            <span className="conta-import-reemplazar-warn">
                              {' '}(las cuentas con movimientos contables se conservarán)
                            </span>
                          )}
                        </label>
                      </div>
                    )}

                    {/* Auto-activar reemplazar si plan vacío (inicio desde cero) */}
                    {estadoPlan?.planVacio && importPC.reemplazar === false && (
                      // inicio desde cero: el reemplazar no aplica (no hay nada que borrar)
                      null
                    )}

                    <div className="conta-import-tabla-wrap">
                      <table className="conta-table conta-import-tabla">
                        <thead>
                          <tr>
                            <th>Fila</th>
                            <th>Código</th>
                            <th>Nombre</th>
                            <th>Tipo</th>
                            <th>Nivel</th>
                            <th>Mov.</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPC.preview.filas.map((f) => (
                            <tr key={f.fila} className={f.estado === 'error' ? 'conta-import-row-error' : ''}>
                              <td>{f.fila}</td>
                              <td><code>{f.codigo}</code></td>
                              <td>{f.estado === 'ok' ? f.data.nombre : f.nombre}</td>
                              <td>{f.estado === 'ok' ? f.data.tipo : '—'}</td>
                              <td>{f.estado === 'ok' ? f.data.nivel : '—'}</td>
                              <td>{f.estado === 'ok' ? (f.data.aceptaMovimiento ? 'Sí' : 'No') : '—'}</td>
                              <td>
                                {f.estado === 'ok'
                                  ? <span className="badge-ok">✓ OK</span>
                                  : <span className="badge-error" title={f.errores?.join(', ')}>✗ {f.errores?.[0]}</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="conta-import-actions">
                      <button
                        className="btn-secondary"
                        onClick={() => setImportPC((p) => ({ ...p, preview: null, archivo: null, reemplazar: false }))}
                      >
                        ← Cambiar archivo
                      </button>
                      {importPC.preview.validos > 0 && (
                        <button
                          className="btn-primary"
                          onClick={ejecutarImportPlan}
                          disabled={importPC.loading}
                        >
                          {importPC.reemplazar
                            ? `Reemplazar plan (${importPC.preview.validos} cuentas)`
                            : `Importar ${importPC.preview.validos} cuenta${importPC.preview.validos !== 1 ? 's' : ''}`
                          }
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Paso 3: resultado */}
                {importPC.resultado && !importPC.loading && (
                  <div className="conta-import-resultado">
                    <div className="conta-import-resultado-ok">
                      ✅ {importPC.resultado.mensaje}
                    </div>
                    {importPC.resultado.data?.eliminadas > 0 && (
                      <div className="conta-import-resultado-info">
                        🗑 {importPC.resultado.data.eliminadas} cuentas del plan anterior eliminadas
                      </div>
                    )}
                    {importPC.resultado.data?.noEliminadas?.length > 0 && (
                      <div className="conta-import-resultado-warn">
                        <strong>⚠ {importPC.resultado.data.noEliminadas.length} cuentas conservadas</strong> (tienen movimientos contables):
                        <ul className="conta-import-errores-lista">
                          {importPC.resultado.data.noEliminadas.map((c, i) => (
                            <li key={i}>{c.codigo} — {c.nombre} ({c.razon})</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {importPC.resultado.data?.erroresDetalle?.length > 0 && (
                      <ul className="conta-import-errores-lista">
                        {importPC.resultado.data.erroresDetalle.map((e, i) => (
                          <li key={i}>Fila {e.fila} ({e.codigo}): {e.error}</li>
                        ))}
                      </ul>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={() => setImportPC({ abierto: true, archivo: null, preview: null, loading: false, resultado: null, reemplazar: false })}
                    >
                      Importar otro archivo
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="conta-card">
            <h3>Plan de cuentas</h3>
            {/* Banner orientativo según estado del plan */}
            <div className="conta-note">
              {hayPlanBase ? (
                <p>
                  El plan de cuentas de esta empresa tiene <strong>{plan.length} cuentas</strong>. El contador puede editar,
                  ampliar o desactivar cuentas. Para añadir cuentas faltantes del catálogo AELA usa <strong>Cargar plan base AELA</strong>;
                  para actualizarlo usa <strong>Sincronizar</strong>. Para el catálogo oficial de la Supercias (308 cuentas NIIF) usa
                  los botones del Plan NIIF.
                </p>
              ) : (
                <div className="conta-plan-opciones-inicio">
                  <div className="conta-plan-opcion">
                    <strong>Plan base AELA</strong> — estructura simplificada (~88 cuentas). Ideal para PYMES, RIMPE y negocios pequeños.
                    <button className="btn-primary" onClick={() => instalarPlanBase(false)} disabled={instalandoPlanBase} style={{ marginLeft: 12 }}>
                      {instalandoPlanBase ? 'Instalando...' : 'Instalar plan AELA'}
                    </button>
                  </div>
                  <div className="conta-plan-opcion">
                    <strong>Plan NIIF Supercias</strong> — Catálogo Único de Cuentas oficial (308 cuentas). Para S.A. y Cía. Ltda. que reportan a la Superintendencia de Compañías.
                    <button className="btn-secondary" onClick={() => instalarPlanSupercias(false)} disabled={instalandoSupercias} style={{ marginLeft: 12 }}>
                      {instalandoSupercias ? 'Instalando...' : 'Instalar plan NIIF'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="conta-filters">
              <input
                placeholder="Buscar por código o nombre"
                value={planFiltros.q}
                onChange={(e) => setPlanFiltros((prev) => ({ ...prev, q: e.target.value }))}
              />
              <select value={planFiltros.tipo} onChange={(e) => setPlanFiltros((prev) => ({ ...prev, tipo: e.target.value }))}>
                <option value="">Todos los tipos</option>
                <option value="ACTIVO">ACTIVO</option>
                <option value="PASIVO">PASIVO</option>
                <option value="PATRIMONIO">PATRIMONIO</option>
                <option value="INGRESO">INGRESO</option>
                <option value="GASTO">GASTO</option>
                <option value="COSTO">COSTO</option>
              </select>
              <select value={planFiltros.activo} onChange={(e) => setPlanFiltros((prev) => ({ ...prev, activo: e.target.value }))}>
                <option value="todos">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
              <label className="conta-check-inline">
                <input
                  type="checkbox"
                  checked={planFiltros.soloMovimiento}
                  onChange={(e) => setPlanFiltros((prev) => ({ ...prev, soloMovimiento: e.target.checked }))}
                />
                Solo movimiento
              </label>
              <button className="btn-secondary" onClick={cargarPlan}>Filtrar</button>
              {hayPlanBase && (
                <>
                  <button className="btn-secondary" onClick={() => instalarPlanBase(false)} disabled={instalandoPlanBase} title="Agrega cuentas AELA faltantes sin borrar las existentes">
                    {instalandoPlanBase ? 'Procesando...' : 'Cargar plan base AELA'}
                  </button>
                  <button className="btn-secondary" onClick={() => instalarPlanBase(true)} disabled={instalandoPlanBase} title="Actualiza nombres y estructura AELA base">
                    Sincronizar AELA
                  </button>
                  <button className="btn-secondary" onClick={() => instalarPlanSupercias(false)} disabled={instalandoSupercias} title="Agrega cuentas NIIF Supercias faltantes">
                    {instalandoSupercias ? 'Procesando...' : 'Cargar plan NIIF'}
                  </button>
                  <button className="btn-secondary" onClick={() => instalarPlanSupercias(true)} disabled={instalandoSupercias} title="Sincroniza con el catálogo oficial Supercias">
                    Sincronizar NIIF
                  </button>
                </>
              )}
            </div>

            {planLoading ? (
              <div className="conta-loading">Cargando plan de cuentas...</div>
            ) : (
              <table className="conta-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>Nivel</th>
                    <th>Mov.</th>
                    <th>Activo</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((cuenta) => (
                    <tr key={cuenta.id}>
                      <td>{cuenta.codigo}</td>
                      <td>{cuenta.nombre}</td>
                      <td>{cuenta.tipo}</td>
                      <td>{cuenta.nivel}</td>
                      <td>{cuenta.aceptaMovimiento ? 'Sí' : 'No'}</td>
                      <td>{cuenta.activo ? 'Sí' : 'No'}</td>
                      <td>
                        <button className="btn-link" onClick={() => editarCuenta(cuenta)}>Editar</button>
                        <button className="btn-link danger" onClick={() => eliminarCuenta(cuenta.id)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                  {plan.length === 0 && (
                    <tr><td colSpan="7" className="conta-empty">No hay cuentas para el filtro aplicado.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'cierre' && (
        <div className="conta-tab-body">
          <div className="conta-card">
            <h3>Asiento inicial del período</h3>
            <form onSubmit={guardarAsientoInicial}>
              <div className="conta-form-grid">
                <div>
                  <label>Período (MM/YYYY)</label>
                  <input
                    value={asientoInicialForm.periodo}
                    onChange={(e) => setAsientoInicialForm((prev) => ({ ...prev, periodo: e.target.value }))}
                    onBlur={() => {
                      const normalizado = normalizarPeriodoMMYYYY(asientoInicialForm.periodo);
                      if (normalizado) {
                        setAsientoInicialForm((prev) => ({ ...prev, periodo: normalizado }));
                      }
                    }}
                    placeholder="03/2026"
                  />
                </div>
                <div>
                  <label>Fecha</label>
                  <input type="date" value={asientoInicialForm.fecha} onChange={(e) => setAsientoInicialForm((prev) => ({ ...prev, fecha: e.target.value }))} required />
                </div>
                <div className="full-width">
                  <label>Descripción</label>
                  <input value={asientoInicialForm.descripcion} onChange={(e) => setAsientoInicialForm((prev) => ({ ...prev, descripcion: e.target.value }))} placeholder="Asiento inicial" />
                </div>
              </div>

              <div className="conta-detail-box">
                <table className="conta-table">
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Descripción</th>
                      <th>Debe</th>
                      <th>Haber</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {asientoInicialForm.detalles.map((d, index) => (
                      <tr key={`ini-${index}`}>
                        <td>
                          <select value={d.cuentaId} onChange={(e) => cambiarDetalleAsientoInicial(index, 'cuentaId', e.target.value)} required>
                            <option value="">Seleccione...</option>
                            {cuentasMovimiento.map((c) => (
                              <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td><input value={d.descripcion} onChange={(e) => cambiarDetalleAsientoInicial(index, 'descripcion', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" value={d.debe} onChange={(e) => cambiarDetalleAsientoInicial(index, 'debe', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" value={d.haber} onChange={(e) => cambiarDetalleAsientoInicial(index, 'haber', e.target.value)} /></td>
                        <td><button type="button" className="btn-link danger" onClick={() => quitarLineaInicial(index)}>Quitar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="conta-form-actions">
                  <button type="button" className="btn-secondary" onClick={agregarLineaInicial}>+ Línea</button>
                  <span className={`conta-balance ${Number(totalDebeInicial.toFixed(2)) === Number(totalHaberInicial.toFixed(2)) ? 'ok' : 'warn'}`}>
                    Debe: {toMoney(totalDebeInicial)} | Haber: {toMoney(totalHaberInicial)}
                  </span>
                  <button type="submit" className="btn-primary">Registrar asiento inicial</button>
                </div>
              </div>
            </form>
          </div>

          <div className="conta-card">
            <h3>Estados financieros y consultas</h3>
            <div className="conta-filters">
              <input
                placeholder="Período MM/YYYY"
                value={estadosFiltros.periodo}
                onChange={(e) => setEstadosFiltros((prev) => ({ ...prev, periodo: e.target.value }))}
                onBlur={() => {
                  const normalizado = normalizarPeriodoMMYYYY(estadosFiltros.periodo);
                  if (normalizado) {
                    setEstadosFiltros((prev) => ({ ...prev, periodo: normalizado }));
                  }
                }}
              />
              <input type="date" value={estadosFiltros.desde} onChange={(e) => setEstadosFiltros((prev) => ({ ...prev, desde: e.target.value }))} />
              <input type="date" value={estadosFiltros.hasta} onChange={(e) => setEstadosFiltros((prev) => ({ ...prev, hasta: e.target.value }))} />
              <input type="date" value={estadosFiltros.fechaBalance} onChange={(e) => setEstadosFiltros((prev) => ({ ...prev, fechaBalance: e.target.value }))} />
              <button className="btn-secondary" onClick={cargarEstadosFinancieros}>Actualizar estados</button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('estados', 'csv', estadosFiltros)}
              >
                Exportar Excel (CSV)
              </button>
              <button
                className="btn-secondary"
                onClick={() => descargarReporteContable('estados', 'pdf', estadosFiltros)}
              >
                PDF Servidor
              </button>
            </div>

            {cierreLoading ? (
              <div className="conta-loading">Procesando estados...</div>
            ) : (
              <>
                <div className="conta-kpis conta-kpis-compact">
                  <div className="conta-kpi"><span>Balance Debe</span><strong>{toMoney(balance?.resumen?.totalDebe)}</strong></div>
                  <div className="conta-kpi"><span>Balance Haber</span><strong>{toMoney(balance?.resumen?.totalHaber)}</strong></div>
                  <div className="conta-kpi"><span>Utilidad</span><strong>{toMoney(estadoResultados?.utilidad)}</strong></div>
                  <div className="conta-kpi"><span>Activos</span><strong>{toMoney(balanceGeneral?.totalActivos)}</strong></div>
                  <div className="conta-kpi"><span>Pasivos + Patrimonio</span><strong>{toMoney((balanceGeneral?.totalPasivos || 0) + (balanceGeneral?.totalPatrimonio || 0))}</strong></div>
                  <div className="conta-kpi"><span>Balanceado</span><strong>{balanceGeneral?.balanceado ? 'Sí' : 'No'}</strong></div>
                </div>

                <table className="conta-table">
                  <thead>
                    <tr>
                      <th>Tipo asiento</th>
                      <th>Cantidad</th>
                      <th>Total Debe</th>
                      <th>Total Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(consultasResumen?.tipos || []).map((t) => (
                      <tr key={t.tipo}>
                        <td>{t.tipo}</td>
                        <td>{t.cantidad}</td>
                        <td>{toMoney(t.totalDebe)}</td>
                        <td>{toMoney(t.totalHaber)}</td>
                      </tr>
                    ))}
                    {(consultasResumen?.tipos || []).length === 0 && (
                      <tr><td colSpan="4" className="conta-empty">Sin datos de consultas para el rango seleccionado.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ContabilidadHub;
