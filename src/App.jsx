import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import CitasMap from "./components/CitasMap.jsx";
import {
  prospectBelongsToVendor,
  resolveVendorFieldsFromSheet,
  getFechaCita,
  getHoraCita,
  normalizeSheetDate,
  parseHoraFromSheetRow,
} from "./lib/vendor.js";
import { postMake } from "./lib/apiClient.js";
import { fetchSheetRange, loginWithPin } from "./lib/sheetsClient.js";
import {
  isDarSeguimiento,
  buildVisitaUpdate,
  buildSeguimientoUpdate,
  buildSeguimientoCompletadoUpdate,
  enrichProspectFromSheet,
  loadProspectOverrides,
  saveProspectOverride,
  mergeProspectWithOverrides,
} from "./lib/prospectLifecycle.js";
import { matchesProspectSearch } from "./lib/prospectSearch.js";
import {
  parseSheetLogRows,
  loadLocalInteractionLogs,
  mergeInteractionLogs,
  countContactInteractions,
  registerInteraction,
} from "./lib/interactionLog.js";

/** Solo configuración pública del cliente (mapa). Secretos viven en /api (Vercel). */
const CONFIG = {
  MAPS_KEY: import.meta.env.VITE_MAPS_KEY || "",
};

// Session stored in memory — resets on app close
let SESSION = JSON.parse(sessionStorage.getItem("ag_session") || "null");
// Global user config - updated on login
let CONFIG_USER = SESSION ? { id: SESSION.id_vendedor, name: SESSION.nombre, email: SESSION.email } : { id: "", name: "", email: "" };

const ZONAS_LIST = [
  'ANZURES','ATIZAPAN','AZCAPOTZALCO','CENTRO','CLAVERIA','COL ESTRELLA',
  'COL GUADALUPE TEPEYAC','COL LINDAVISTA','CONDESA Y ROMA','COPILCO UNIVERSIDAD',
  'COYOACAN','CUAUHTEMOC','DEL VALLE','ECATEPEC','GRANADA','GUADALUPE TEPEYAC',
  'GUSTAVO A MADERO','HERRADURA','INTERLOMAS','IZTACALCO','IZTAPALAPA',
  'LOMAS DE CHAPULTEPEC','LOMAS VERDES','NAPOLES','NARVARTE','NAUCALPAN',
  'ORIENTE','PACHUCA','PACHUCA_CENTRO','PACHUCA_INDUSTRIAL','PACHUCA_LOMAS',
  'PACHUCA_NORTE','PACHUCA_PLATA','PACHUCA_SANJAVIER','PACHUCA_SUR','PACHUCA_VILLAS',
  'PEDREGAL','POLANCO','POPOTLA','SAN ANGEL','SAN MARTIN','SAN MIGUEL CHAPULTEPEC',
  'SAN RAFAEL','SANTA FE','SATELITE','TECAMACHALCO',
  'TLALPAN','TLANEPANTLA','TLATELOLCO','VILLA COAPA','XOCHIMILCO',
];

const ESTADO_CONFIG = {
  NUEVO:{color:"#94A3B8",bg:"#F8FAFC",label:"Nuevo"},
  EN_ZONA:{color:"#60A5FA",bg:"#EFF6FF",label:"En Zona"},
  LLAMADA_PENDIENTE:{color:"#8B5CF6",bg:"#EDE9FE",label:"Llamada Pend."},
  NO_CONTESTA_1:{color:"#F59E0B",bg:"#FFFBEB",label:"NC ×1"},
  NO_CONTESTA_2:{color:"#F97316",bg:"#FFF7ED",label:"NC ×2"},
  NO_CONTESTA_MAX:{color:"#EF4444",bg:"#FEF2F2",label:"NC Max"},
  CALLBACK_SOLICITADO:{color:"#A78BFA",bg:"#F5F3FF",label:"Callback"},
  CITA_AGENDADA:{color:"#10B981",bg:"#ECFDF5",label:"Cita Agendada"},
  VISITADO_INTERESADO:{color:"#0EA5E9",bg:"#E0F2FE",label:"Interesado"},
  VISITADO_NO_INTERESADO:{color:"#6B7280",bg:"#F3F4F6",label:"No Interesado"},
  PRIMER_PEDIDO:{color:"#EC4899",bg:"#FCE7F3",label:"Primer Pedido"},
  CLIENTE_ACTIVO:{color:"#059669",bg:"#D1FAE5",label:"Cliente"},
  TRANSFERIDO_TECNICO:{color:"#0891B2",bg:"#ECFEFF",label:"Transferido"},
  CLIENTE_REACTIVAR:{color:"#F59E0B",bg:"#FFFBEB",label:"Reactivar"},
  CLIENTE_PERDIDO:{color:"#6B7280",bg:"#F3F4F6",label:"Perdido"},
  TEL_INVALIDO:{color:"#EF4444",bg:"#FEF2F2",label:"Tel Inválido"},
  DESCARTADO:{color:"#DC2626",bg:"#FEF2F2",label:"Descartado"},
};

const OBJECIONES = [
  { value:"YA_TIENE_LAB", label:"Ya tiene laboratorio", icon:"🏥" },
  { value:"PRECIO", label:"Precio / muy caro", icon:"💰" },
  { value:"FUTURA_LABS", label:"Contrato con Futura Labs", icon:"📄" },
  { value:"OTRO_LAB_CONSIDERA", label:"Otro lab pero nos considera", icon:"🤝" },
  { value:"SIN_TIEMPO", label:"Sin tiempo para visita", icon:"⏰" },
  { value:"NO_INTERESA", label:"No le interesa", icon:"❌" },
  { value:"NINGUNA", label:"Sin objeción", icon:"✅" },
];

const RESULTADO_VISITA = [
  { value:"INTERESADO", label:"Interesado", icon:"✅", color:"#10B981" },
  { value:"NECESITA_PENSAR", label:"Lo piensa", icon:"🤔", color:"#F59E0B" },
  { value:"NO_INTERESADO", label:"No interesa", icon:"❌", color:"#EF4444" },
  { value:"NO_ESTABA", label:"No estaba", icon:"🚪", color:"#64748B" },
];

const today = new Date();
const fmt = d => d.toISOString().split("T")[0];
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate()+n); return r; };
const getWeekKey = d => {
  const jan1 = new Date(d.getFullYear(),0,1);
  const w = Math.ceil(((d-jan1)/86400000+jan1.getDay()+1)/7);
  return `${d.getFullYear()}-W${String(w).padStart(2,"0")}`;
};
const W0 = getWeekKey(today);
const W1 = getWeekKey(addDays(today,7));
const W2 = getWeekKey(addDays(today,14));


// Normalize phone to 52XXXXXXXXXX format (no + sign)
function normalizeTel(tel) {
  if (!tel) return "";
  let s = String(tel).replace(".0","").replace(/\s/g,"").replace("+","");
  // Remove duplicate 52 prefix
  if (s.startsWith("5252")) s = s.slice(2);
  // If 10 digits, add 52
  if (s.length === 10) s = "52" + s;
  // If 11 digits starting with 1, replace with 52
  if (s.length === 11 && s.startsWith("1")) s = "52" + s.slice(1);
  return s;
}

const MOCK = [
  {id:"PRO-0002",nombre:"Dentistakids",doctor:"",telefono:"+525562036910",email:"dentistakidscontacto@gmail.com",direccion:"C. Gobernador Ignacio Esteva 19B, San Miguel Chapultepec, CDMX",zona:"SAN MIGUEL CHAPULTEPEC",estado:"NUEVO",score:563,intentos:0,notas:"",vendedor:"VEND-001",seguimiento:false,tipoAccion:"",proximaAccion:"",labActual:"",resultadoVisita:"",waOptIn:false,waNumero:"",fechaCita:"",horaCita:"",objecion:"",clinicaDigital:""},
  {id:"PRO-0003",nombre:"Fundación Mil Sonrisas",doctor:"Dr. García",telefono:"+525598765432",email:"",direccion:"Av. Juárez 15, Centro Histórico, CDMX",zona:"CUAUHTEMOC",estado:"VISITADO_INTERESADO",score:485,intentos:1,notas:"Muy interesado, 3 sillones",vendedor:"VEND-001",seguimiento:true,tipoAccion:"WHATSAPP",proximaAccion:fmt(addDays(today,1)),labActual:"Lab Express",resultadoVisita:"INTERESADO",waOptIn:true,waNumero:"+525598765432",fechaCita:"",horaCita:"",objecion:"PRECIO",clinicaDigital:"DIGITAL"},
  {id:"PRO-0004",nombre:"La Clínica Dental Roma",doctor:"Dr. Soto",telefono:"+525512345678",email:"",direccion:"Av. Ámsterdam 45, Condesa, CDMX",zona:"CONDESA Y ROMA",estado:"CITA_AGENDADA",score:455,intentos:1,notas:"Cita confirmada",vendedor:"VEND-001",seguimiento:false,tipoAccion:"VISITA",proximaAccion:fmt(today),labActual:"",resultadoVisita:"",waOptIn:false,waNumero:"",fechaCita:fmt(today),horaCita:"10:00",objecion:"",clinicaDigital:"IMPRESIONES"},
  {id:"PRO-0005",nombre:"Smile Plus Polanco",doctor:"Dra. Vargas",telefono:"+525544332211",email:"",direccion:"Presidente Masaryk 111, Polanco, CDMX",zona:"POLANCO",estado:"CITA_AGENDADA",score:442,intentos:1,notas:"",vendedor:"VEND-001",seguimiento:false,tipoAccion:"VISITA",proximaAccion:fmt(today),labActual:"",resultadoVisita:"",waOptIn:true,waNumero:"",fechaCita:fmt(today),horaCita:"12:30",objecion:"",clinicaDigital:""},
  {id:"PRO-0006",nombre:"Dentech Popotla",doctor:"",telefono:"+525587654321",email:"",direccion:"Calle Popotla 23, Popotla, CDMX",zona:"POPOTLA",estado:"NUEVO",score:435,intentos:0,notas:"",vendedor:"VEND-001",seguimiento:false,tipoAccion:"",proximaAccion:"",labActual:"",resultadoVisita:"",waOptIn:false,waNumero:"",fechaCita:"",horaCita:"",objecion:"",clinicaDigital:""},
  {id:"PRO-0009",nombre:"OdontoPlus Condesa",doctor:"Dra. Reyes",telefono:"+525533221100",email:"",direccion:"Calle Veracruz 45, Condesa, CDMX",zona:"CONDESA Y ROMA",estado:"CITA_AGENDADA",score:350,intentos:1,notas:"",vendedor:"VEND-001",seguimiento:false,tipoAccion:"VISITA",proximaAccion:fmt(today),labActual:"",resultadoVisita:"",waOptIn:false,waNumero:"",fechaCita:fmt(today),horaCita:"15:00",objecion:"",clinicaDigital:""},
  {id:"PRO-0008",nombre:"Centro Dental Narvarte",doctor:"Dr. Mendoza",telefono:"+525566778899",email:"",direccion:"Eje 5 Sur 120, Narvarte, CDMX",zona:"NARVARTE",estado:"VISITADO_INTERESADO",score:367,intentos:1,notas:"Quiere cotización implantes",vendedor:"VEND-001",seguimiento:true,tipoAccion:"LLAMADA",proximaAccion:fmt(addDays(today,2)),labActual:"",resultadoVisita:"NECESITA_PENSAR",waOptIn:false,waNumero:"",fechaCita:"",horaCita:"",objecion:"FUTURA_LABS",clinicaDigital:"DIGITAL"},
];

const INIT_PLAN = {
  [W0]:{semana:W0,LUNES:"POLANCO",MARTES:"POLANCO",MIÉRCOLES:"CONDESA Y ROMA",JUEVES:"CONDESA Y ROMA",VIERNES:"NARVARTE",locked:true},
  [W1]:{semana:W1,LUNES:"SANTA FE",MARTES:"SATELITE",MIÉRCOLES:"DEL VALLE",JUEVES:"NARVARTE",VIERNES:"COYOACAN",locked:false},
  [W2]:{semana:W2,LUNES:"",MARTES:"",MIÉRCOLES:"",JUEVES:"",VIERNES:"",locked:false},
};

// ── SMALL COMPONENTS ──────────────────────────────────────────
function StatusBadge({estado,small}){
  const c=ESTADO_CONFIG[estado]||{color:"#64748B",bg:"#F8FAFC",label:estado};
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:small?"2px 8px":"4px 10px",borderRadius:20,fontSize:small?10:11,fontWeight:700,color:c.color,backgroundColor:c.bg,border:`1px solid ${c.color}30`,whiteSpace:"nowrap"}}><span style={{width:6,height:6,borderRadius:"50%",backgroundColor:c.color,flexShrink:0}}/>{c.label}</span>;
}
function ScoreBadge({score}){
  const color=score>400?"#059669":score>200?"#D97706":"#64748B";
  const bg=score>400?"#D1FAE5":score>200?"#FEF3C7":"#F8FAFC";
  return <span style={{padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700,color,backgroundColor:bg}}>★ {Math.round(score)}</span>;
}
function Avatar({name,size=32}){
  const i=name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  return <div style={{width:size,height:size,borderRadius:"50%",background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.35,fontWeight:700,color:"white",flexShrink:0}}>{i}</div>;
}
function Toast({message,type,onClose}){
  useEffect(()=>{const t=setTimeout(onClose,4000);return()=>clearTimeout(t);},[onClose]);
  const c={success:"#10B981",error:"#EF4444",info:"#0EA5E9",warning:"#F59E0B"};
  return <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",backgroundColor:c[type]||c.info,color:"white",padding:"12px 20px",borderRadius:12,fontSize:14,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.25)",zIndex:9999,maxWidth:340,textAlign:"center",animation:"slideUp .3s ease"}}>{message}</div>;
}

// ── NOTIFICATION PANEL ─────────────────────────────────────────
function NotifPanel({notifications,onDismiss,onClose}){
  return(
    <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.5)",zIndex:2000,display:"flex",alignItems:"flex-start",justifyContent:"flex-end"}} onClick={onClose}>
      <div style={{width:300,height:"100%",background:"white",boxShadow:"-8px 0 32px rgba(0,0,0,0.15)",overflowY:"auto",padding:16}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700}}>Notificaciones</div>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer"}}>✕</button>
        </div>
        {notifications.length===0
          ?<div style={{textAlign:"center",padding:"40px 20px",color:"#94A3B8"}}><div style={{fontSize:32}}>🔔</div><div style={{fontSize:14,marginTop:8}}>Sin notificaciones</div></div>
          :notifications.map(n=>(
            <div key={n.id} style={{padding:"12px",background:n.read?"#F8FAFC":"#EFF6FF",borderRadius:12,marginBottom:8,border:`1px solid ${n.read?"#F1F5F9":"#BAE6FD"}`}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:4}}>{n.icon} {n.title}</div>
                  <div style={{fontSize:12,color:"#64748B"}}>{n.body}</div>
                  <div style={{fontSize:11,color:"#94A3B8",marginTop:4}}>{n.time}</div>
                </div>
                <button onClick={()=>onDismiss(n.id)} style={{background:"none",border:"none",color:"#94A3B8",cursor:"pointer",fontSize:14,padding:"0 0 0 8px"}}>✕</button>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── CALL MODAL ─────────────────────────────────────────────────
function CallModal({prospecto,plan,onClose,onCallDirect,onCallSystem}){
  const [sel,setSel]=useState("direct");
  const [enZona,setEnZona]=useState(false);
  const DIAS=["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES"];
  const diasConZona=DIAS.filter(d=>plan?.[d]===prospecto.zona);

  return(
    <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.6)",zIndex:1500,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}} onClick={onClose}>
      <div style={{background:"white",borderRadius:20,padding:24,width:"100%",maxWidth:400}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:36,marginBottom:8}}>📞</div>
          <div style={{fontSize:17,fontWeight:700}}>{prospecto.nombre}</div>
          <div style={{fontSize:13,color:"#64748B",marginTop:4}}>{prospecto.zona} · {prospecto.telefono}</div>
        </div>

        <div style={{marginBottom:16}}>
          {[
            {id:"direct",icon:"📲",title:"Llamar yo ahora",desc:"Tu teléfono marca directamente",color:"#0EA5E9"},
            {id:"system_now",icon:"🤖",title:"Ana llama ahora",desc:"El sistema llama y agenda cita",color:"#8B5CF6"},
            {id:"system_zone",icon:"📅",title:"Ana llama para día de zona",desc:diasConZona.length>0?`${prospecto.zona} = ${diasConZona.join(", ")}`:"Zona sin asignar esta semana",color:"#10B981"},
          ].map(opt=>(
            <div key={opt.id} onClick={()=>setSel(opt.id)} style={{padding:"12px",border:`2px solid ${sel===opt.id?opt.color:"#E2E8F0"}`,borderRadius:12,marginBottom:8,cursor:"pointer",background:sel===opt.id?opt.color+"10":"white"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22}}>{opt.icon}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{opt.title}</div>
                  <div style={{fontSize:12,color:"#64748B"}}>{opt.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {(sel==="system_now"||sel==="system_zone")&&(
          <div style={{padding:"10px 12px",background:"#F5F3FF",borderRadius:10,marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <input type="checkbox" id="enZona" checked={enZona} onChange={e=>setEnZona(e.target.checked)} style={{width:18,height:18,cursor:"pointer"}}/>
            <label htmlFor="enZona" style={{fontSize:13,fontWeight:600,color:"#7C3AED",cursor:"pointer"}}>
              📍 Estoy en la zona ahora — Ana puede ofrecer visita inmediata
            </label>
          </div>
        )}

        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"12px",background:"#F1F5F9",border:"none",borderRadius:12,fontSize:14,fontWeight:600,cursor:"pointer",color:"#64748B"}}>Cancelar</button>
          <button onClick={()=>{
            if(sel==="direct") onCallDirect();
            else onCallSystem(sel==="system_now"?"now":"zone",enZona);
            onClose();
          }} style={{flex:2,padding:"12px",background:sel==="direct"?"#0EA5E9":sel==="system_now"?"#8B5CF6":"#10B981",border:"none",borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",color:"white"}}>
            {sel==="direct"?"📲 Llamar":sel==="system_now"?"🤖 Enviar a Ana":"📅 Agendar por zona"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PROSPECTO MODAL ────────────────────────────────────────────
function ProspectoModal({p,onClose,onUpdate,onToast,plan,addNotif,onLogInteraction}){
  const [tab,setTab]=useState("info");
  const [showCall,setShowCall]=useState(false);
  const [form,setForm]=useState({
    resultadoVisita:p.resultadoVisita||"",
    notas:p.notas||"",
    labActual:p.labActual||"",
    objecion:p.objecion||"",
    clinicaDigital:p.clinicaDigital||"",
    waOptIn:p.waOptIn||false,
    waNumero:p.waNumero||"",
    tipoAccion:p.tipoAccion||"",
    proximaAccion:p.proximaAccion||"",
    nombreDoctor:p.doctor||"",
    fechaCompromiso:p.fechaCompromiso||"",
  });

  const save=async()=>{
    if(tab==="seguimiento"){
      if(!form.tipoAccion||!form.proximaAccion){
        onToast("⚠️ Elige tipo y fecha de próxima acción","error");
        return;
      }
      const updates = buildSeguimientoUpdate(form, p);
      if(form.telefonoUpdate) updates.telefono = normalizeTel(form.telefonoUpdate);
      onUpdate(p.id, updates);
      if (onLogInteraction && ["LLAMADA", "WHATSAPP", "EMAIL", "VISITA"].includes(form.tipoAccion)) {
        onLogInteraction({
          prospecto: p,
          tipo: form.tipoAccion,
          origen: "modal_seguimiento",
          notas: form.notasUpdate || "",
        }).catch(() => {});
      }
      try {
        await postMake("e7", Object.assign({
            accion:"completar_seguimiento",
            id_prospecto:p.id,
            id_vendedor:CONFIG_USER.id,
            vendedor:CONFIG_USER.name,
            tipo_accion: form.tipoAccion,
            proxima_accion: form.proximaAccion,
            resultado_visita: form.tipoAccion,
            estado_update: updates.estado,
          },
          form.telefonoUpdate&&normalizeTel(form.telefonoUpdate)?{telefono_update:normalizeTel(form.telefonoUpdate)}:{},
          form.estadoUpdate&&form.estadoUpdate!==""?{estado_update:form.estadoUpdate}:{},
          form.notasUpdate&&form.notasUpdate.trim()!==""?{notas_update:form.notasUpdate.trim()}:{}
          ));
        onToast("✅ Seguimiento guardado","success");
      } catch(e){ onToast("✅ Guardado (Make pendiente)","info"); }
      onClose();
      return;
    }
    if(!form.resultadoVisita){
      onToast("⚠️ Selecciona resultado de visita","error");
      return;
    }
    const updates = buildVisitaUpdate(form, p);
    onUpdate(p.id, updates);
    try {
      await postMake("e7", {
          accion:"registrar_visita",
          id_prospecto:p.id,
          resultado_visita:form.resultadoVisita,
          estado_update: updates.estado,
          notas:form.notas,
          lab_actual:form.labActual,
          doctor:form.nombreDoctor,
          wa_opt_in:form.waOptIn,
          tipo_accion:form.tipoAccion,
          proxima_accion:form.proximaAccion,
          clinica_digital:form.clinicaDigital,
          objecion:form.objecion,
          vendedor:CONFIG_USER.name,
          id_vendedor:CONFIG_USER.id,
        });
      onToast("✅ Visita guardada en Sheet","success");
    } catch(e){
      onToast("✅ Guardado localmente","info");
    }
    onClose();
  };

  const inp={width:"100%",padding:"10px 12px",border:"1.5px solid #E2E8F0",borderRadius:10,fontSize:14,outline:"none",boxSizing:"border-box"};
  const lbl={fontSize:12,color:"#64748B",marginBottom:4,display:"block",fontWeight:600};

  const saveAgendarCita = async() => {
    if(!form.fechaCita||!form.horaCita){ onToast("⚠️ Selecciona fecha y hora","error"); return; }
    try {
      await postMake("e7", {
          accion: "book_appointments_cal",
          id_prospecto: p.id,
          id_vendedor: CONFIG_USER.id,
          nombre_doctor: p.doctor||p.nombre,
          nombre_clinica: p.nombre,
          telefono: p.telefono,
          direccion: p.direccion,
          fecha_cita: form.fechaCita,
          hora_cita: form.horaCita,
          duracion_minutos: "30",
          vendedor: CONFIG_USER.name,
        });
      onUpdate(p.id, {
        estado:"CITA_AGENDADA",
        proximaAccion: form.fechaCita,
        horaCita: form.horaCita,
        seguimiento: false,
      });
      onToast("📅 Cita agendada en Google Calendar","success");
      onClose();
    } catch(e){ onToast("Error al agendar cita","error"); }
  };

  const savePrimerPedido = async() => {
    const today = new Date().toISOString().split("T")[0];
    try {
      await postMake("e7", {
          accion: "primer_pedido",
          id_prospecto: p.id,
          id_vendedor: CONFIG_USER.id,
          vendedor: CONFIG_USER.name,
          fecha_primer_pedido: today,
        });
      onUpdate(p.id, {estado:"PRIMER_PEDIDO", esCliente:true});
      onToast("🎉 Primer pedido registrado — ¡cliente nuevo!","success");
      onClose();
    } catch(e) { onToast("Error al registrar primer pedido","error"); }
  };

  return(
    <>
      <div style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"flex-end"}} onClick={onClose}>
        <div style={{width:"100%",maxWidth:480,margin:"0 auto",backgroundColor:"#fff",borderRadius:"20px 20px 0 0",maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
          
          {/* Header */}
          <div style={{padding:"20px 20px 0",borderBottom:"1px solid #F1F5F9",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div style={{flex:1,marginRight:12}}>
                <div style={{fontSize:17,fontWeight:700,color:"#0F172A",marginBottom:4}}>{p.nombre}</div>
                <div style={{fontSize:13,color:"#64748B",marginBottom:8}}>{p.zona}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <StatusBadge estado={p.estado} small/>
                  <ScoreBadge score={p.score}/>
                  {p.clinicaDigital&&<span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:12,background:p.clinicaDigital==="DIGITAL"?"#EDE9FE":"#FEF3C7",color:p.clinicaDigital==="DIGITAL"?"#7C3AED":"#92400E"}}>{p.clinicaDigital==="DIGITAL"?"🖥️ Digital":"📷 Impresiones"}</span>}
                </div>
              </div>
              <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16,color:"#64748B"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,paddingBottom:16}}>
              <button onClick={()=>setShowCall(true)} style={{flex:1,padding:"10px 0",background:"#EFF6FF",color:"#0EA5E9",border:"1.5px solid #BAE6FD",borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>📞 Llamar</button>
              <button onClick={async()=>{const waNum=p.waNumero&&p.waNumero.trim()!==""?p.waNumero:"";if(!waNum){alert("Sin número WhatsApp. Captura en Registrar → Número WhatsApp.");return;}if(onLogInteraction){try{await onLogInteraction({prospecto:p,tipo:"WHATSAPP",origen:"modal_whatsapp"});}catch(e){}}window.open(`https://wa.me/${waNum.replace("+","")}`, "_blank");}} style={{flex:1,padding:"10px 0",background:"#F0FDF4",color:"#10B981",border:"1.5px solid #A7F3D0",borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>💬 WA</button>
              <button onClick={()=>window.open(`https://maps.google.com/?q=${encodeURIComponent(p.direccion)}`,"_blank")} style={{flex:1,padding:"10px 0",background:"#F5F3FF",color:"#8B5CF6",border:"1.5px solid #DDD6FE",borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>🗺️ Maps</button>
            </div>
            <div style={{display:"flex"}}>
              {["info","visita","seguimiento"].map(t=>(
                <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderBottom:`2px solid ${tab===t?"#0EA5E9":"transparent"}`,fontSize:13,fontWeight:600,cursor:"pointer",color:tab===t?"#0EA5E9":"#94A3B8"}}>
                  {t==="info"?"Info":t==="visita"?"Registrar":"Seguimiento"}
                </button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflowY:"auto",padding:20}}>
            {tab==="info"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[["📞","Teléfono",p.telefono],["📧","Email",p.email||"—"],["📍","Dirección",p.direccion],["🏥","Lab actual",p.labActual||"—"],["👤","Doctor",p.doctor||"—"],["🔄","Intentos",p.intentos||0],["📝","Notas",[(p.ult_resultado?"📞 "+p.ult_resultado:""),(p.notas?"📋 "+p.notas:"")].filter(Boolean).join(" | ")||"—"],
                 ["📅","1er Pedido",p.fechaPrimerPedido||"—"],
                 ["🔄","Últ. Pedido",p.fechaUltimoPedido||"—"],
                 ["💰","Facturación",p.facturacion?("$"+Number(p.facturacion).toLocaleString("es-MX")):"—"]].map(([icon,label,value])=>(
                  <div key={label} style={{padding:"10px 14px",background:"#F8FAFC",borderRadius:10}}>
                    <div style={{fontSize:11,color:"#94A3B8",marginBottom:2}}>{icon} {label}</div>
                    <div style={{fontSize:14,color:"#0F172A",wordBreak:"break-word"}}>{value}</div>
                  </div>
                ))}
                {p.objecion&&<div style={{padding:"10px 14px",background:"#FFFBEB",borderRadius:10,border:"1px solid #FCD34D"}}>
                  <div style={{fontSize:11,color:"#92400E",marginBottom:2}}>⚠️ Objeción registrada</div>
                  <div style={{fontSize:14,color:"#92400E",fontWeight:600}}>{OBJECIONES.find(o=>o.value===p.objecion)?.label||p.objecion}</div>
                </div>}
              </div>
            )}

            {tab==="visita"&&(
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                {/* Resultado */}
                <div>
                  <label style={lbl}>Resultado de la visita</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {RESULTADO_VISITA.map(r=>(
                      <button key={r.value} onClick={()=>setForm(f=>({...f,resultadoVisita:r.value}))} style={{padding:"10px 8px",border:`2px solid ${form.resultadoVisita===r.value?r.color:"#E2E8F0"}`,borderRadius:10,background:form.resultadoVisita===r.value?r.color+"15":"white",fontSize:12,fontWeight:600,cursor:"pointer",color:form.resultadoVisita===r.value?r.color:"#64748B"}}>
                        {r.icon} {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Objeción */}
                <div>
                  <label style={lbl}>Objeción principal (si hubo)</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    {OBJECIONES.map(o=>(
                      <button key={o.value} onClick={()=>setForm(f=>({...f,objecion:f.objecion===o.value?"":o.value}))} style={{padding:"8px",border:`2px solid ${form.objecion===o.value?"#F59E0B":"#E2E8F0"}`,borderRadius:10,background:form.objecion===o.value?"#FFFBEB":"white",fontSize:11,fontWeight:600,cursor:"pointer",color:form.objecion===o.value?"#92400E":"#64748B",textAlign:"left"}}>
                        {o.icon} {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clínica digital */}
                <div>
                  <label style={lbl}>¿Cómo trabaja la clínica?</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    {[{v:"DIGITAL",l:"Digital",i:"🖥️",c:"#7C3AED"},{v:"IMPRESIONES",l:"Impresiones",i:"📷",c:"#D97706"},{v:"AMBOS",l:"Ambos",i:"🔀",c:"#0EA5E9"}].map(opt=>(
                      <button key={opt.v} onClick={()=>setForm(f=>({...f,clinicaDigital:f.clinicaDigital===opt.v?"":opt.v}))} style={{padding:"10px 6px",border:`2px solid ${form.clinicaDigital===opt.v?opt.c:"#E2E8F0"}`,borderRadius:10,background:form.clinicaDigital===opt.v?opt.c+"15":"white",fontSize:11,fontWeight:600,cursor:"pointer",color:form.clinicaDigital===opt.v?opt.c:"#64748B",textAlign:"center"}}>
                        <div style={{fontSize:18,marginBottom:2}}>{opt.i}</div>{opt.l}
                      </button>
                    ))}
                  </div>
                </div>

                <div><label style={lbl}>Nombre del doctor</label>
                  <input value={form.nombreDoctor} onChange={e=>setForm(f=>({...f,nombreDoctor:e.target.value}))} placeholder="Dr. ..." style={inp}/>
                </div>
                <div><label style={lbl}>Número WhatsApp</label>
                  <input value={form.waNumero||""} onChange={e=>setForm(f=>({...f,waNumero:e.target.value}))} placeholder="+52 55 XXXX XXXX" style={inp}/>
                </div>
                <div><label style={lbl}>Lab con el que trabajan hoy</label>
                  <input value={form.labActual} onChange={e=>setForm(f=>({...f,labActual:e.target.value}))} placeholder="Nombre del laboratorio..." style={inp}/>
                </div>
                <div><label style={lbl}>Notas de la visita</label>
                  <textarea value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Observaciones, intereses..." rows={3} style={{...inp,resize:"none"}}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#F0FDF4",borderRadius:10}}>
                  <input type="checkbox" id="wa" checked={form.waOptIn} onChange={e=>setForm(f=>({...f,waOptIn:e.target.checked}))} style={{width:18,height:18,cursor:"pointer"}}/>
                  <label htmlFor="wa" style={{fontSize:13,color:form.waOptIn?"#065F46":"#64748B",fontWeight:600,cursor:"pointer"}}>{form.waOptIn?"✅ Aceptó recibir WhatsApp":"⬜ ¿Acepta recibir WhatsApp?"}</label>
                </div>
                <button onClick={save} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",color:"white",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer"}}>Guardar Visita</button>
              </div>
            )}

            {tab==="seguimiento"&&(
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div>
                  <label style={lbl}>Próxima acción</label>
                  <div style={{display:"flex",gap:8}}>
                    <select value={form.tipoAccion} onChange={e=>setForm(f=>({...f,tipoAccion:e.target.value}))} style={{...inp,flex:1}}>
                      <option value="">Tipo...</option>
                      {["LLAMADA","WHATSAPP","EMAIL","VISITA","ESPERAR"].map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <input type="date" value={form.proximaAccion} onChange={e=>setForm(f=>({...f,proximaAccion:e.target.value}))} style={{...inp,flex:1}}/>
                  </div>
                </div>
                <div><label style={lbl}>Fecha compromiso del doctor</label>
                  <input type="date" value={form.fechaCompromiso} onChange={e=>setForm(f=>({...f,fechaCompromiso:e.target.value}))} style={inp}/>
                </div>
                <div><label style={lbl}>Actualizar Teléfono</label>
                  <input type="tel" placeholder="52XXXXXXXXXX" value={form.telefonoUpdate||""} onChange={e=>setForm(f=>({...f,telefonoUpdate:e.target.value}))} style={inp}/>
                </div>
                <div><label style={lbl}>Actualizar Estado</label>
                  <select value={form.estadoUpdate||""} onChange={e=>setForm(f=>({...f,estadoUpdate:e.target.value}))} style={inp}>
                    <option value="">Sin cambio...</option>
                    <option value="VISITADO_INTERESADO">✅ Visitado Interesado</option>
                    <option value="CITA_AGENDADA">📅 Cita Agendada</option>
                    <option value="CALLBACK_SOLICITADO">📞 Callback Solicitado</option>
                    <option value="PRIMER_PEDIDO">🎉 Primer Pedido</option>
                    <option value="CLIENTE_ACTIVO">⭐ Cliente Activo</option>
                    <option value="CLIENTE_REACTIVAR">🔄 Reactivar</option>
                    <option value="CLIENTE_PERDIDO">😔 Cliente Perdido</option>
                    <option value="VISITADO_NO_INTERESADO">❌ No Interesado</option>
                    <option value="DESCARTADO">🗑️ Descartado</option>
                  </select>
                </div>
                <div><label style={lbl}>Notas de la conversación</label>
                  <textarea value={form.notasUpdate||""} onChange={e=>setForm(f=>({...f,notasUpdate:e.target.value}))} placeholder="¿Qué pasó en esta llamada o mensaje?..." style={{...inp,height:80,resize:"vertical"}}/>
                </div>
                <button onClick={save} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#10B981,#0EA5E9)",color:"white",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:8}}>Guardar Seguimiento</button>
                <div style={{background:"#EDE9FE",borderRadius:12,padding:"12px 14px",border:"1.5px solid #DDD6FE"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#7C3AED",marginBottom:10}}>📅 Agendar Cita</div>
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <input type="date" value={form.fechaCita||""} onChange={e=>setForm(f=>({...f,fechaCita:e.target.value}))} style={{...inp,flex:1}} placeholder="Fecha"/>
                    <input type="time" value={form.horaCita||""} onChange={e=>setForm(f=>({...f,horaCita:e.target.value}))} style={{...inp,flex:1}} placeholder="Hora"/>
                  </div>
                  <button onClick={saveAgendarCita} disabled={!form.fechaCita||!form.horaCita} style={{width:"100%",padding:"10px",background:form.fechaCita&&form.horaCita?"#7C3AED":"#C4B5FD",color:"white",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:form.fechaCita&&form.horaCita?"pointer":"not-allowed"}}>
                    📅 Confirmar Cita en Calendario
                  </button>
                </div>
                <button onClick={()=>savePrimerPedido()} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#EC4899,#F97316)",color:"white",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer"}}>🎉 Registrar Primer Pedido</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCall&&<CallModal prospecto={p} plan={INIT_PLAN[W0]} onClose={()=>setShowCall(false)}
        onCallDirect={async()=>{if(onLogInteraction){try{await onLogInteraction({prospecto:p,tipo:"LLAMADA",origen:"modal_llamada"});}catch(e){}}const t=normalizeTel(p.telefono);const local=t.startsWith("52")?t.slice(2):t;window.open(`tel:${local}`,"_self");}}
        onCallSystem={async(mode,enZona)=>{
          onToast(enZona?"🤖 Ana ofrece visita inmediata...":"🤖 Ana está llamando...","info");
          try {
            await postMake("e5",{zona:p.zona,id_vendedor:CONFIG_USER.id,max_llamadas:1,vendedora_en_zona:enZona,id_prospecto:p.id,telefono:normalizeTel(p.telefono)});
            addNotif({id:Date.now(),icon:"🤖",title:"Ana llamó a "+p.nombre,body:enZona?"Ana ofreció que puedes pasar hoy mismo.":"Ana intentará agendar cita.",time:"Ahora mismo",read:false});
          } catch(e){
            onToast("⚠️ Error de conexión","error");
          }
        }}/>}
    </>
  );
}

// ── VIEW: MAPA DEL DÍA ─────────────────────────────────────────
function MapaDelDia({prospectos,onSelect,onToast,addNotif,plan,vendorId}){
  const [vistaFecha,setVistaFecha]=useState("hoy");
  const startOfWeek=new Date(today);
  startOfWeek.setDate(today.getDate()-today.getDay()+1);
  const endOfWeek=new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate()+6);
  const fmtShort=d=>d.toLocaleDateString("es-MX",{weekday:"short",day:"numeric",month:"short"});

  const citasHoy=prospectos.filter(p=>p.estado==="CITA_AGENDADA"&&getFechaCita(p)===fmt(today)&&prospectBelongsToVendor(p,vendorId)).sort((a,b)=>getHoraCita(a).localeCompare(getHoraCita(b)));
  const citasSemana=prospectos.filter(p=>{
    if(p.estado!=="CITA_AGENDADA") return false;
    const fc=getFechaCita(p);
    if(!fc||!prospectBelongsToVendor(p,vendorId)) return false;
    const d=new Date(fc+"T12:00:00");
    return d>=startOfWeek&&d<=endOfWeek;
  }).sort((a,b)=>{
    const fa=getFechaCita(a), fb=getFechaCita(b);
    if(fa!==fb) return fa.localeCompare(fb);
    return getHoraCita(a).localeCompare(getHoraCita(b));
  });
  const citasMostrar=vistaFecha==="hoy"?citasHoy:citasSemana;
  // Zonas del plan semanal actual del vendedor
  const planHoy = plan && plan[W0] ? plan[W0] : null;
  const zonasDelPlan = planHoy ? [
    planHoy.LUNES, planHoy.MARTES, planHoy["MIÉRCOLES"],
    planHoy.JUEVES, planHoy.VIERNES
  ].filter(z=>z&&z.trim()!=="") : [];
  const zonasDeDia = [...new Set(zonasDelPlan)]; // deduplicated
  const zonas = zonasDeDia.length > 0 ? zonasDeDia :
    [...new Set(prospectos.filter(p=>p.estado!=="CLIENTE_ACTIVO"&&p.estado!=="DESCARTADO"&&prospectBelongsToVendor(p,vendorId)).map(p=>p.zona))].slice(0,6);

  return(
    <div style={{height:"100%",overflowY:"auto",padding:"0 0 80px"}}>
      <div style={{padding:"16px 16px 8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:"#0F172A"}}>{vistaFecha==="hoy"?"Citas de hoy":"Citas de la semana"}</div>
          <span style={{background:"#D1FAE5",color:"#059669",borderRadius:12,padding:"2px 8px",fontSize:12,fontWeight:700}}>{citasMostrar.length} citas</span>
          <div style={{fontSize:12,color:"#64748B",marginLeft:"auto"}}>{vistaFecha==="hoy"?today.toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"}):fmtShort(startOfWeek)+" - "+fmtShort(endOfWeek)}</div>
        </div>
        <div style={{display:"flex",background:"#F1F5F9",borderRadius:10,padding:3,marginBottom:12}}>
          {[{v:"hoy",l:"Hoy",count:citasHoy.length},{v:"semana",l:"Esta semana",count:citasSemana.length}].map(opt=>(
            <button key={opt.v} onClick={()=>setVistaFecha(opt.v)} style={{flex:1,padding:"8px",background:vistaFecha===opt.v?"white":"transparent",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",color:vistaFecha===opt.v?"#0F172A":"#94A3B8",boxShadow:vistaFecha===opt.v?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>
              {opt.l} {opt.count>0&&<span style={{background:vistaFecha===opt.v?"#D1FAE5":"#E2E8F0",color:vistaFecha===opt.v?"#059669":"#64748B",borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:700}}>{opt.count}</span>}
            </button>
          ))}
        </div>
        {citasMostrar.length===0
          ?<div style={{padding:"20px",background:"#F8FAFC",borderRadius:14,textAlign:"center",color:"#94A3B8"}}><div style={{fontSize:24,marginBottom:6}}>📅</div><div style={{fontSize:13}}>No hay citas {vistaFecha==="hoy"?"para hoy":"esta semana"}</div></div>
          :<div style={{position:"relative",paddingLeft:28}}>
            <div style={{position:"absolute",left:10,top:20,bottom:20,width:2,background:"linear-gradient(180deg,#0EA5E9,#8B5CF6)",borderRadius:2}}/>
            {citasMostrar.map(c=>(
              <div key={c.id} onClick={()=>onSelect(c)} style={{marginBottom:12,cursor:"pointer",position:"relative"}}>
                <div style={{position:"absolute",left:-18,width:16,height:16,borderRadius:"50%",background:"#0EA5E9",border:"3px solid white",boxShadow:"0 0 0 2px #0EA5E9",marginTop:16}}/>
                <div style={{padding:"12px 14px",background:"white",borderRadius:12,boxShadow:"0 2px 8px rgba(0,0,0,0.08)",border:"1.5px solid #E0F2FE"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{c.nombre}</div>
                      <div style={{fontSize:12,color:"#64748B",marginTop:2}}>{c.doctor||"Doctor no registrado"} · {c.zona}</div>
                      <div style={{fontSize:12,color:"#94A3B8",marginTop:2}}>📍 {c.direccion?.split(",").slice(0,2).join(",")}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                      <div style={{fontSize:22,fontWeight:800,color:"#0EA5E9"}}>{getHoraCita(c)||"—"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        }
      </div>

      {/* Mapa Leaflet + geocoding Google */}
      <div style={{margin:"8px 16px",borderRadius:16,overflow:"hidden",border:"1.5px solid #E2E8F0"}}>
        {citasMostrar.length>0 ? (
          <div>
            <CitasMap
              citas={citasMostrar}
              prospectos={prospectos}
              vendedorId={vendorId}
              mapsKey={CONFIG.MAPS_KEY}
              onSelect={onSelect}
            />
            {/* Citas como lista de botones que abren Maps */}
            <div style={{padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
              {citasMostrar.map((c,i)=>(
                <button key={c.id}
                  onClick={()=>window.open(`https://maps.google.com/?q=${encodeURIComponent(c.direccion||c.nombre)}`,"_blank")}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"#F8FAFC",border:"1.5px solid #E2E8F0",borderRadius:10,cursor:"pointer",textAlign:"left",width:"100%"}}>
                  <span style={{width:22,height:22,background:"#10B981",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"white",flexShrink:0}}>{i+1}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#0F172A",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.nombre}</div>
                    <div style={{fontSize:11,color:"#64748B",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📍 {c.direccion?.split(",").slice(0,2).join(",")}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:16,fontWeight:800,color:"#0EA5E9"}}>{getHoraCita(c)||"—"}</div>
                    <div style={{fontSize:10,color:"#10B981",fontWeight:600}}>Abrir →</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ):(
          <div style={{height:120,background:"linear-gradient(135deg,#F8FAFC,#EFF6FF)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:6,color:"#94A3B8"}}>
            <span style={{fontSize:28}}>📅</span>
            <span style={{fontSize:13}}>No hay citas {vistaFecha==="hoy"?"hoy":"esta semana"}</span>
          </div>
        )}
      </div>

      {/* Llamar por zona */}
      <div style={{padding:"12px 16px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"#0F172A",marginBottom:10}}>Pedir a Ana que llame por zona</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {zonas.map(zona=>{
            const count=prospectos.filter(p=>p.zona===zona&&["NUEVO","LLAMADA_PENDIENTE"].includes(p.estado)).length;
            return(
              <button key={zona} onClick={async()=>{
  onToast(`🤖 Enviando llamadas en ${zona}...`,"info");
  try {
    await postMake("e5", {zona, id_vendedor:CONFIG_USER.id, max_llamadas:3});
    onToast(`✅ Ana llamando en ${zona}`,"success");
    addNotif({id:Date.now(),icon:"🤖",title:`Llamadas iniciadas en ${zona}`,body:"Ana está contactando prospectos. Te avisamos cuando haya citas.",time:"Ahora mismo",read:false});
  } catch(e) {
    onToast("⚠️ Error de conexión","error");
  }
}} style={{padding:"10px 12px",background:"white",border:"1.5px solid #E2E8F0",borderRadius:12,cursor:"pointer",textAlign:"left",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#0F172A"}}>{zona}</div>
                <div style={{fontSize:11,color:"#64748B",marginTop:2}}>{count} disponibles</div>
                <div style={{fontSize:10,color:"#8B5CF6",marginTop:4,fontWeight:600}}>🤖 Que Ana llame →</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── VIEW: LISTA ─────────────────────────────────────────────────
function ListaDelDia({prospectos,onSelect,vendorId}){
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("TODOS");
  const QUICK=["TODOS","NUEVO","CITA_AGENDADA","DAR_SEGUIMIENTO","PRIMER_PEDIDO","CLIENTE","DESCARTADO"];

  const QUICK_LABELS={"TODOS":"Todos","NUEVO":"Nuevo","CITA_AGENDADA":"Cita Agendada","DAR_SEGUIMIENTO":"Dar Seguimiento","PRIMER_PEDIDO":"Primer Pedido","CLIENTE":"Cliente","DESCARTADO":"Descartado"};

  const filtered=prospectos
    .filter(p=>(filter==="DESCARTADO"||p.estado!=="DESCARTADO"&&p.estado!=="CLIENTE_PERDIDO")&&(vendorId?prospectBelongsToVendor(p,vendorId):true))
    .filter(p=>matchesProspectSearch(p, search, ESTADO_CONFIG))
    .filter(p=>{
      if(filter==="TODOS") return true;
      if(filter==="DAR_SEGUIMIENTO") return isDarSeguimiento(p);
      if(filter==="CLIENTE") return p.estado==="CLIENTE_ACTIVO";
      if(filter==="DESCARTADO") return ["DESCARTADO","CLIENTE_PERDIDO"].includes(p.estado);
      if(filter==="NUEVO") return p.estado==="NUEVO";
      return p.estado===filter;
    })
    .sort((a,b)=>b.score-a.score);
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"12px 16px 0"}}>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:15}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Clínica, doctor, zona, reactivar..." style={{width:"100%",padding:"10px 12px 10px 38px",border:"1.5px solid #E2E8F0",borderRadius:12,fontSize:14,outline:"none",boxSizing:"border-box",background:"#F8FAFC"}}/>
        </div>
      </div>
      <div style={{padding:"10px 16px",display:"flex",gap:6,overflowX:"auto"}}>
        {QUICK.map(f=>{
          const c=ESTADO_CONFIG[f];
          return <button key={f} onClick={()=>setFilter(f)} style={{padding:"6px 12px",borderRadius:20,border:`1.5px solid ${filter===f?(c?.color||"#0EA5E9"):"#E2E8F0"}`,background:filter===f?(c?.bg||"#EFF6FF"):"white",fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",color:filter===f?(c?.color||"#0EA5E9"):"#94A3B8"}}>
            {QUICK_LABELS[f]||c?.label||f}
          </button>;
        })}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 80px"}}>
        {filtered.map(p=>(
          <div key={p.id} onClick={()=>onSelect(p)} style={{padding:"14px",background:"white",borderRadius:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,0.06)",cursor:"pointer",border:"1.5px solid #F1F5F9"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{flex:1,marginRight:8}}>
                <div style={{fontSize:15,fontWeight:700,color:"#0F172A",marginBottom:2}}>{p.nombre}</div>
                <div style={{fontSize:12,color:"#64748B"}}>📍 {p.zona} {p.doctor&&`· ${p.doctor}`}</div>
              </div>
              <ScoreBadge score={p.score}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:4}}>
              <StatusBadge estado={p.estado} small/>
              <div style={{display:"flex",gap:4}}>
                {p.clinicaDigital&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:8,background:p.clinicaDigital==="DIGITAL"?"#EDE9FE":"#FEF3C7",color:p.clinicaDigital==="DIGITAL"?"#7C3AED":"#92400E"}}>{p.clinicaDigital==="DIGITAL"?"🖥️":"📷"}</span>}
                {p.fechaCita===fmt(today)&&p.horaCita&&<span style={{fontSize:11,fontWeight:700,color:"#10B981",background:"#ECFDF5",padding:"3px 8px",borderRadius:8}}>🕐 {p.horaCita}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── VIEW: CHECKLIST ─────────────────────────────────────────────
function Checklist({prospectos,onSelect,onUpdate,onToast,vendorId,onLogInteraction}){
  const pend=prospectos.filter(p=>isDarSeguimiento(p)&&!p.seguimiento&&prospectBelongsToVendor(p,vendorId)).sort((a,b)=>new Date(a.proximaAccion||"9999")-new Date(b.proximaAccion||"9999"));
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"16px 16px 8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:15,fontWeight:700}}>Seguimiento pendiente</div>
          <span style={{background:"#FEE2E2",color:"#EF4444",borderRadius:12,padding:"2px 8px",fontSize:12,fontWeight:700}}>{pend.length}</span>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 80px"}}>
        {pend.length===0
          ?<div style={{textAlign:"center",padding:"60px 20px",color:"#94A3B8"}}><div style={{fontSize:40,marginBottom:12}}>🎉</div><div style={{fontSize:15,fontWeight:600}}>¡Todo al día!</div></div>
          :pend.map(p=>{
            const urgent=p.proximaAccion&&new Date(p.proximaAccion+"T12:00:00")<=new Date();
            const obj=OBJECIONES.find(o=>o.value===p.objecion);
            return(
              <div key={p.id} onClick={()=>onSelect(p)} style={{padding:"14px",background:urgent?"#FFFBFB":"white",borderRadius:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,0.06)",cursor:"pointer",border:`1.5px solid ${urgent?"#FEE2E2":"#F1F5F9"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700}}>{p.nombre}</div>
                    <div style={{fontSize:12,color:"#64748B",marginTop:2}}>
                      {p.tipoAccion==="WHATSAPP"?"💬":p.tipoAccion==="LLAMADA"?"📞":"🏥"} {p.tipoAccion||"Acción pendiente"}
                      {p.proximaAccion&&` · ${new Date(p.proximaAccion+"T12:00:00").toLocaleDateString("es-MX",{weekday:"short",day:"numeric",month:"short"})}`}
                    </div>
                    {obj&&<div style={{fontSize:11,color:"#92400E",background:"#FEF3C7",padding:"2px 6px",borderRadius:6,display:"inline-block",marginTop:4}}>{obj.icon} {obj.label}</div>}
                  </div>
                  {urgent&&<span style={{fontSize:10,fontWeight:700,color:"#EF4444",background:"#FEE2E2",padding:"3px 8px",borderRadius:8,height:"fit-content"}}>HOY</span>}
                </div>
                {p.notas&&<div style={{fontSize:12,color:"#64748B",marginBottom:8,fontStyle:"italic",background:"#F8FAFC",padding:"6px 10px",borderRadius:8}}>"{p.notas}"</div>}
                <div style={{display:"flex",gap:6}}>
                  <button onClick={async e=>{
  e.stopPropagation();
  if(onLogInteraction){try{await onLogInteraction({prospecto:p,tipo:"LLAMADA",origen:"check_llamada"});}catch(err){}}
  const t=normalizeTel(p.telefono);
  const local=t.startsWith("52")?t.slice(2):t;
  if(local) window.open(`tel:${local}`,"_self");
  onToast("📞 Llamada registrada","success");
}} style={{flex:1,padding:"8px 0",background:"#EFF6FF",color:"#0EA5E9",border:"1.5px solid #BAE6FD",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer"}}>📞 Llamar</button>
                  <button onClick={async e=>{
  e.stopPropagation();
  if(onLogInteraction){try{await onLogInteraction({prospecto:p,tipo:"WHATSAPP",origen:"check_whatsapp"});}catch(err){}}
  window.open(`https://wa.me/${(p.waNumero||p.telefono).replace("+","")}`,"_blank");
  onToast("💬 WhatsApp registrado","info");
}} style={{flex:1,padding:"8px 0",background:"#F0FDF4",color:"#10B981",border:"1.5px solid #A7F3D0",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer"}}>💬 WA</button>
                  <button onClick={async e=>{
  e.stopPropagation();
  const tipo=["LLAMADA","WHATSAPP","EMAIL","VISITA"].includes(p.tipoAccion)?p.tipoAccion:"LLAMADA";
  if(onLogInteraction){try{await onLogInteraction({prospecto:p,tipo,origen:"check_hecho"});}catch(err){}}
  const updates = buildSeguimientoCompletadoUpdate(p, {});
  onUpdate(p.id, updates);
  try{
    await postMake("e7",{accion:"completar_seguimiento",id_prospecto:p.id,id_vendedor:CONFIG_USER.id,marca_hecho:true,tipo_accion:tipo});
    onToast("✅ Completado y guardado","success");
  }catch(e){onToast("✅ Completado","success");}
}} style={{flex:1,padding:"8px 0",background:"#F8FAFC",color:"#64748B",border:"1.5px solid #E2E8F0",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer"}}>✅ Hecho</button>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ── VIEW: PLAN SEMANAL (3 semanas) ─────────────────────────────
function PlanSemanal({prospectos,onToast,plan,setPlan}){
  const WEEKS=[{key:W0,label:"Esta semana",short:"W0"},{key:W1,label:"Próx. semana",short:"W1"},{key:W2,label:"En 2 semanas",short:"W2"}];
  const [active,setActive]=useState(W1);
  // plan and setPlan come from AppMain props — no local state needed



  const DIAS=["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES"];
  const getCount=zona=>prospectos.filter(p=>p.zona===zona&&p.estado!=="CLIENTE_ACTIVO"&&p.estado!=="DESCARTADO").length;
  const getCitas=zona=>prospectos.filter(p=>p.zona===zona&&p.estado==="CITA_AGENDADA").length;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      {/* 3 tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #F1F5F9",background:"white",flexShrink:0}}>
        {WEEKS.map(w=>(
          <button key={w.key} onClick={()=>setActive(w.key)} style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:`2px solid ${active===w.key?"#0EA5E9":"transparent"}`,fontSize:12,fontWeight:700,cursor:"pointer",color:active===w.key?"#0EA5E9":"#94A3B8"}}>
            {w.label}
            {w.key===W0&&<div style={{fontSize:9,color:"#10B981",marginTop:2}}>🔒 Agendado</div>}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"12px 16px 80px"}}>
        {/* Lock notice for current week */}
        {active===W0&&(
          <div style={{padding:"12px 14px",background:"#F0FDF4",border:"1.5px solid #A7F3D0",borderRadius:12,marginBottom:14,display:"flex",gap:10,alignItems:"flex-start"}}>
            <span style={{fontSize:24,flexShrink:0}}>🔒</span>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#065F46"}}>Semana en curso — solo lectura</div>
              <div style={{fontSize:12,color:"#065F46",marginTop:2}}>Las citas ya están agendadas. Puedes ver el plan pero no modificarlo.</div>
            </div>
          </div>
        )}

        {/* Advance week banner on Fridays */}
        {active===W1&&today.getDay()===5&&(
          <div style={{padding:"12px 14px",background:"#FFFBEB",border:"1.5px solid #FCD34D",borderRadius:12,marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:"#92400E"}}>¡Es viernes! Avanza el plan 📅</div>
            <div style={{fontSize:12,color:"#92400E",marginTop:4}}>Mañana la próxima semana se convierte en esta semana.</div>
            <button onClick={async()=>{
                const planW1 = plan[W1] || {};
                // Save W1 as new W0 in Sheet
                try {
                  await postMake("e7",{
                      accion:"plan_semanal",
                      semana:W0,
                      id_vendedor:CONFIG_USER.id,
                      lunes:planW1.LUNES||"",
                      martes:planW1.MARTES||"",
                      miercoles:planW1["MIÉRCOLES"]||"",
                      jueves:planW1.JUEVES||"",
                      viernes:planW1.VIERNES||""
                    });
                  // Update local state
                  setPlan(prev=>({
                    ...prev,
                    [W0]:{...prev[W1],semana:W0,locked:true},
                    [W1]:{...prev[W2],semana:W1,locked:false},
                    [W2]:{semana:W2,LUNES:"",MARTES:"",MIÉRCOLES:"",JUEVES:"",VIERNES:"",locked:false}
                  }));
                  onToast("✅ Plan avanzado y guardado","success");
                  setActive(W0);
                } catch(e){
                  onToast("Error al avanzar plan","error");
                }
              }} style={{marginTop:8,padding:"6px 14px",background:"#F59E0B",color:"white",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
              Avanzar plan →
            </button>
          </div>
        )}

        {DIAS.map(dia=>{
          const zona=plan[active]?.[dia]||"";
          const locked=active===W0;
          return(
            <div key={dia} style={{marginBottom:10,background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",opacity:locked?0.85:1}}>
              <div style={{padding:"10px 14px",background:locked?"#F0FDF4":"#F8FAFC",borderBottom:"1px solid #F1F5F9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#0F172A"}}>{dia}</div>
                <div style={{display:"flex",gap:6}}>
                  {zona&&<span style={{fontSize:11,color:"#64748B",background:"#F1F5F9",padding:"2px 8px",borderRadius:8}}>{getCount(zona)} prospects</span>}
                  {zona&&getCitas(zona)>0&&<span style={{fontSize:11,color:"#10B981",background:"#ECFDF5",padding:"2px 8px",borderRadius:8,fontWeight:700}}>🟢 {getCitas(zona)} citas</span>}
                </div>
              </div>
              <div style={{padding:"10px 14px"}}>
                {locked
                  ?<div style={{padding:"8px 10px",background:"#F8FAFC",borderRadius:8,fontSize:13,color:"#0F172A",fontWeight:600}}>{zona||<span style={{color:"#94A3B8"}}>Sin zona asignada</span>}</div>
                  :<select value={zona} onChange={e=>setPlan(prev=>({...prev,[active]:{...prev[active],[dia]:e.target.value}}))} style={{width:"100%",padding:"8px 10px",border:"1.5px solid #E2E8F0",borderRadius:8,fontSize:13,outline:"none",background:"white"}}>
                    <option value="">Sin zona</option>
                    {ZONAS_LIST.map(z=><option key={z} value={z}>{z}</option>)}
                  </select>
                }
              </div>
            </div>
          );
        })}

        {!plan[active]?.locked&&(
          <button onClick={async()=>{
            try{
              await postMake("e7",{accion:"plan_semanal",semana:active,id_vendedor:CONFIG_USER.id,
                  lunes:plan[active]?.LUNES||"",martes:plan[active]?.MARTES||"",
                  miercoles:plan[active]?.MIÉRCOLES||"",jueves:plan[active]?.JUEVES||"",
                  viernes:plan[active]?.VIERNES||""});
              onToast("💾 Plan guardado en Sheet","success");
              const data=await fetchSheetRange("Plan Semanal!A2:R50");
              const planData={...plan};
              (data.values||[]).forEach(row=>{
                  const semana=row[1]||"";
                  const idVend=row[3]||"";
                  if(![W0,W1,W2].includes(semana)||idVend!==CONFIG_USER.id) return;
                  planData[semana]={
                    semana,
                    LUNES:row[4]||"",MARTES:row[5]||"",
                    MIÉRCOLES:row[6]||"",JUEVES:row[7]||"",
                    VIERNES:row[8]||"",locked:semana===W0,
                  };
                });
                setPlan(planData);
            }catch(e){onToast("💾 Plan guardado","success");}
          }} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",color:"white",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",marginTop:4}}>
            💾 Guardar Plan
          </button>
        )}
      </div>
    </div>
  );
}

// ── VIEW: NUEVA CLINICA ─────────────────────────────────────────
function NuevaClinica({onToast,addNotif,prospectos}){
  const [mode,setMode]=useState("agregar"); // "agregar" | "visite"
  const [form,setForm]=useState({nombre:"",telefono:"",direccion:"",zona:"",notas:"",doctor:"",labActual:"",resultadoVisita:"",objecion:"",clinicaDigital:"",waOptIn:false,tipoAccion:"",proximaAccion:""});

  const inp={width:"100%",padding:"10px 12px",border:"1.5px solid #E2E8F0",borderRadius:10,fontSize:14,outline:"none",boxSizing:"border-box"};
  const lbl={fontSize:12,color:"#64748B",marginBottom:4,display:"block",fontWeight:600};

  const handleSave=async(andCall=false, isPrimerPedido=false)=>{
    if(!form.nombre||!form.telefono){onToast("⚠️ Nombre y teléfono requeridos","error");return;}
    if(mode==="visite"&&(!form.proximaAccion||!form.tipoAccion)){onToast("⚠️ Próxima acción: tipo y fecha requeridos","error");return;}

    // Map resultado_visita to correct ESTADO
    const estadoMap = {
      "INTERESADO":     "VISITADO_INTERESADO",
      "NECESITA_PENSAR":"VISITADO_INTERESADO",  // sigue en pipeline
      "NO_INTERESADO":  "VISITADO_NO_INTERESADO",
      "NO_ESTABA":      "NUEVO",                // volver a intentar
    };
    const estadoFinal = mode==="visite" && form.resultadoVisita
      ? (estadoMap[form.resultadoVisita] || "NUEVO")
      : "NUEVO";

    try{
      await postMake("e7",{
          accion:"nueva_clinica",
          nombre:form.nombre,telefono:normalizeTel(form.telefono),
          direccion:form.direccion,zona:form.zona,
          notas:form.notas,doctor:form.doctor,
          lab_actual:form.labActual,
          resultado_visita:mode==="visite"?form.resultadoVisita:"",
          estado_override:estadoFinal,
          wa_opt_in:form.waOptIn,wa_numero:normalizeTel(form.waNumero),
          tipo_accion:form.tipoAccion,
          proxima_accion:form.proximaAccion,clinica_digital:form.clinicaDigital,
          objecion:form.objecion,vendedor:CONFIG_USER.name,
          id_vendedor:CONFIG_USER.id,
          es_visita:mode==="visite",
        });
      onToast(mode==="visite"?"✅ Visita registrada en Sheet":"✅ Clínica guardada en Sheet","success");
      if(isPrimerPedido){
        const today=new Date().toISOString().split("T")[0];
        await postMake("e7",{accion:"primer_pedido",id_prospecto:"NUEVO-"+Date.now(),id_vendedor:CONFIG_USER.id,vendedor:CONFIG_USER.name,fecha_primer_pedido:today});
        onToast("🎉 Primer pedido registrado","success");
      }
    }catch(e){onToast("✅ Clínica agregada","success");}

    setForm({nombre:"",telefono:"",direccion:"",zona:"",notas:"",doctor:"",labActual:"",resultadoVisita:"",objecion:"",clinicaDigital:"",waOptIn:false,tipoAccion:"",proximaAccion:""});
  };

  return(
    <div style={{height:"100%",overflowY:"auto",padding:"16px 16px 80px"}}>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:16,fontWeight:700,color:"#0F172A"}}>Nueva Clínica</div>
        <div style={{fontSize:13,color:"#64748B"}}>Encontré una clínica en el camino</div>
      </div>

      {/* Toggle: solo agregar vs ya visité */}
      <div style={{display:"flex",background:"#F1F5F9",borderRadius:12,padding:4,marginBottom:20}}>
        {[{v:"agregar",l:"Solo agregar",i:"➕"},{v:"visite",l:"Ya la visité",i:"🏥"}].map(opt=>(
          <button key={opt.v} onClick={()=>setMode(opt.v)} style={{flex:1,padding:"10px",background:mode===opt.v?"white":"transparent",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",color:mode===opt.v?"#0F172A":"#94A3B8",boxShadow:mode===opt.v?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>
            {opt.i} {opt.l}
          </button>
        ))}
      </div>

      {/* Datos básicos — siempre visibles */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
        <div><label style={lbl}>Nombre de la clínica *</label>
          <input value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))} placeholder="Ej: Clínica Dental Polanco" style={inp}/>
        </div>
        <div><label style={lbl}>Teléfono *</label>
          <input value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))} placeholder="+52 55 XXXX XXXX" type="tel" style={inp}/>
        </div>
        <div><label style={lbl}>Dirección</label>
          <input value={form.direccion} onChange={e=>setForm(f=>({...f,direccion:e.target.value}))} placeholder="Calle, Colonia" style={inp}/>
        </div>
        <div><label style={lbl}>Zona</label>
          <select value={form.zona} onChange={e=>setForm(f=>({...f,zona:e.target.value}))} style={inp}>
            <option value="">Selecciona zona...</option>
            {ZONAS_LIST.map(z=><option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      {/* Datos extendidos si ya visitó */}
      {mode==="visite"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12,padding:"16px",background:"#F8FAFC",borderRadius:14,marginBottom:16,border:"1.5px solid #E2E8F0"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:4}}>📋 Datos de la visita</div>

          <div>
            <label style={lbl}>Resultado</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {RESULTADO_VISITA.map(r=>(
                <button key={r.value} onClick={()=>setForm(f=>({...f,resultadoVisita:r.value}))} style={{padding:"8px",border:`2px solid ${form.resultadoVisita===r.value?r.color:"#E2E8F0"}`,borderRadius:10,background:form.resultadoVisita===r.value?r.color+"15":"white",fontSize:11,fontWeight:600,cursor:"pointer",color:form.resultadoVisita===r.value?r.color:"#64748B"}}>
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={lbl}>Objeción</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {OBJECIONES.slice(0,6).map(o=>(
                <button key={o.value} onClick={()=>setForm(f=>({...f,objecion:f.objecion===o.value?"":o.value}))} style={{padding:"6px 8px",border:`2px solid ${form.objecion===o.value?"#F59E0B":"#E2E8F0"}`,borderRadius:8,background:form.objecion===o.value?"#FFFBEB":"white",fontSize:10,fontWeight:600,cursor:"pointer",color:form.objecion===o.value?"#92400E":"#64748B",textAlign:"left"}}>
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={lbl}>¿Clínica digital o impresiones?</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              {[{v:"DIGITAL",l:"Digital",i:"🖥️"},{v:"IMPRESIONES",l:"Impresiones",i:"📷"},{v:"AMBOS",l:"Ambos",i:"🔀"}].map(opt=>(
                <button key={opt.v} onClick={()=>setForm(f=>({...f,clinicaDigital:f.clinicaDigital===opt.v?"":opt.v}))} style={{padding:"8px",border:`2px solid ${form.clinicaDigital===opt.v?"#0EA5E9":"#E2E8F0"}`,borderRadius:8,background:form.clinicaDigital===opt.v?"#EFF6FF":"white",fontSize:10,fontWeight:600,cursor:"pointer",textAlign:"center",color:form.clinicaDigital===opt.v?"#0EA5E9":"#64748B"}}>
                  <div style={{fontSize:16}}>{opt.i}</div>{opt.l}
                </button>
              ))}
            </div>
          </div>

          <div><label style={lbl}>Nombre del doctor</label>
            <input value={form.doctor} onChange={e=>setForm(f=>({...f,doctor:e.target.value}))} placeholder="Dr. ..." style={inp}/>
          </div>
          <div><label style={lbl}>Número WhatsApp</label>
            <input value={form.waNumero||""} onChange={e=>setForm(f=>({...f,waNumero:e.target.value}))} placeholder="+52 55 XXXX XXXX" style={inp}/>
          </div>
          <div><label style={lbl}>Lab con el que trabajan</label>
            <input value={form.labActual} onChange={e=>setForm(f=>({...f,labActual:e.target.value}))} placeholder="Nombre del laboratorio..." style={inp}/>
          </div>
          <div><label style={lbl}>Notas</label>
            <textarea value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Observaciones..." rows={2} style={{...inp,resize:"none"}}/>
          </div>
          <div>
            <label style={lbl}>Próxima acción</label>
            <div style={{display:"flex",gap:8}}>
              <select value={form.tipoAccion} onChange={e=>setForm(f=>({...f,tipoAccion:e.target.value}))} style={{...inp,flex:1}}>
                <option value="">Tipo...</option>
                {["LLAMADA","WHATSAPP","EMAIL","VISITA"].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={form.proximaAccion} onChange={e=>setForm(f=>({...f,proximaAccion:e.target.value}))} style={{...inp,flex:1}}/>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#F0FDF4",borderRadius:10}}>
            <input type="checkbox" id="waNew" checked={form.waOptIn} onChange={e=>setForm(f=>({...f,waOptIn:e.target.checked}))} style={{width:16,height:16,cursor:"pointer"}}/>
            <label htmlFor="waNew" style={{fontSize:12,color:form.waOptIn?"#065F46":"#64748B",fontWeight:600,cursor:"pointer"}}>{form.waOptIn?"✅ Aceptó recibir WhatsApp":"⬜ ¿Acepta recibir WhatsApp?"}</label>
          </div>
        </div>
      )}

      <button onClick={()=>handleSave(false)} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#10B981,#0EA5E9)",color:"white",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:10}}>
        {mode==="visite"?"🏥 Guardar Visita":"➕ Agregar al Sistema"}
      </button>

      {mode==="agregar"&&(
        <div style={{padding:"12px 14px",background:"#F0FDF4",border:"1.5px solid #BBF7D0",borderRadius:12}}>
          <div style={{fontSize:12,color:"#166534"}}>💡 Para que Ana llame a esta clínica, recarga la app y búscala en Lista → toca "Ana llama ahora"</div>
        </div>
      )}

      {/* Prospectos cercanos en la zona */}
      {form.zona&&(()=>{
        const cercanos=prospectos.filter(p=>p.zona===form.zona&&["NUEVO","LLAMADA_PENDIENTE"].includes(p.estado)).slice(0,3);
        if(cercanos.length===0) return null;
        return(
          <div style={{marginTop:16}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Más prospectos en {form.zona}</div>
            {cercanos.map(p=>(
              <div key={p.id} style={{padding:"10px 12px",background:"white",borderRadius:10,marginBottom:8,border:"1.5px solid #E2E8F0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{p.nombre}</div>
                  <ScoreBadge score={p.score}/>
                </div>
                <button onClick={async()=>{
  try {
    await postMake("e5",{zona:p.zona,id_vendedor:CONFIG_USER.id,max_llamadas:1});
    addNotif({id:Date.now(),icon:"🤖",title:"Ana llamó a "+p.nombre,body:"Te notificamos cuando termine.",time:"Ahora mismo",read:false});
  } catch(e){}
}} style={{padding:"6px 12px",background:"#8B5CF6",color:"white",border:"none",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  Ana llama
                </button>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}



// ── DASHBOARD GERENCIA ──────────────────────────────────────────
function DashboardGerencia({prospectos,interactionLogs}){
  const now=new Date();
  const thisYear=now.getFullYear();
  const thisMonth=now.getMonth();
  const today=now.toISOString().split("T")[0];
  const weekStart=new Date(now);
  weekStart.setDate(now.getDate()-now.getDay()+1);
  const weekStartStr=weekStart.toISOString().split("T")[0];

  const [embFiltro,setEmbFiltro]=useState("total");
  const [tab,setTab]=useState("semanal");

  const VENDEDORES_DASH=[
    {id:"total",name:"Todos"},
    {id:"VEND-001",name:"Areli"},
    {id:"VEND-003",name:"Daniela"},
    {id:"VEND-002",name:"Ivan"},
    {id:"VEND-004",name:"NPMC"},
    {id:"VEND-005",name:"AGLD"},
  ];

  const filtrados=embFiltro==="total"?prospectos:prospectos.filter(p=>prospectBelongsToVendor(p,embFiltro));

  const ESTADOS_EMBUDO=[
    {key:"NUEVO",label:"Nuevos",color:"#94A3B8",countFn:p=>p.estado==="NUEVO"},
    {key:"DAR_SEGUIMIENTO",label:"Dar Seguimiento",color:"#F59E0B",countFn:p=>isDarSeguimiento(p)},
    {key:"VISITADO_INTERESADO",label:"Interesados",color:"#3B82F6",countFn:p=>p.estado==="VISITADO_INTERESADO"},
    {key:"CITA_AGENDADA",label:"Citas Agendadas",color:"#8B5CF6",countFn:p=>p.estado==="CITA_AGENDADA"},
    {key:"PRIMER_PEDIDO",label:"Primer Pedido",color:"#EC4899",countFn:p=>p.estado==="PRIMER_PEDIDO"},
    {key:"CLIENTE_ACTIVO",label:"Clientes Activos",color:"#10B981",countFn:p=>p.estado==="CLIENTE_ACTIVO"},
    {key:"CLIENTE_REACTIVAR",label:"A Reactivar",color:"#D97706",countFn:p=>p.estado==="CLIENTE_REACTIVAR"},
    {key:"DESCARTADO",label:"Descartados",color:"#EF4444",countFn:p=>p.estado==="DESCARTADO"},
    {key:"CLIENTE_PERDIDO",label:"Clientes Perdidos",color:"#6B7280",countFn:p=>p.estado==="CLIENTE_PERDIDO"},
  ];

  const getEmbCount=(e)=>filtrados.filter(e.countFn||((p)=>p.estado===e.key)).length;
  const maxEmb=Math.max(...ESTADOS_EMBUDO.map(e=>getEmbCount(e)),1);

  const vends=[
    {id:"VEND-001",name:"Areli Rios"},
    {id:"VEND-003",name:"Daniela Rivera"},
    {id:"VEND-002",name:"Ivan Jimenez"},
  ];

  const getMetricasSemana=(vendId)=>{
    const vp=prospectos.filter(p=>prospectBelongsToVendor(p,vendId));
    const seguimientos=countContactInteractions(interactionLogs,{
      vendorId:vendId,
      fechaMin:weekStartStr,
    });
    const visitas=vp.filter(p=>p.fechaVisita&&p.fechaVisita>=weekStartStr).length;
    const primerPedido=vp.filter(p=>p.cuentaPrimerPedido==="1"&&p.fechaPrimerPedido&&p.fechaPrimerPedido>=weekStartStr).length;
    const descartados=vp.filter(p=>
      (p.estado==="DESCARTADO"||p.estado==="CLIENTE_PERDIDO")&&
      p.ult_contacto&&p.ult_contacto>=weekStartStr
    ).length;
    const clientes=vp.filter(p=>p.estado==="CLIENTE_ACTIVO"||p.estado==="PRIMER_PEDIDO").length;
    return {seguimientos,visitas,primerPedido,descartados,clientes};
  };

  const months=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
    .map((label,m)=>({label,m}));

  const getCountMes=(vendId,m,year)=>{
    const base=vendId==="total"?prospectos:prospectos.filter(p=>prospectBelongsToVendor(p,vendId));
    return base.filter(p=>{
      if(p.cuentaPrimerPedido!=="1")return false;
      const d=p.fechaPrimerPedido||"";
      if(!d)return false;
      const dd=new Date(d);
      return dd.getMonth()===m&&dd.getFullYear()===year;
    }).length;
  };

  const calcG=(curr,prev)=>{
    if(curr===0&&prev===0)return "–";
    if(curr===0)return "–";
    if(!prev||prev===0)return "nuevo";
    const g=Math.round(((curr-prev)/prev)*100);
    return(g>=0?"+":"")+g+"%";
  };

  const card={background:"white",borderRadius:12,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"};

  const MetChip=({val,icon,label,color})=>(
    <div style={{flex:1,background:"#F8FAFC",borderRadius:10,padding:"8px 4px",textAlign:"center",border:"1px solid #E2E8F0"}}>
      <div style={{fontSize:16,marginBottom:2}}>{icon}</div>
      <div style={{fontSize:18,fontWeight:800,color:color||"#6366F1"}}>{val}</div>
      <div style={{fontSize:8,color:"#94A3B8",marginTop:2,lineHeight:1.2}}>{label}</div>
    </div>
  );

  return(
    <div style={{height:"100%",overflowY:"auto",background:"#F8FAFC",padding:"16px"}}>
      <div style={{fontSize:18,fontWeight:800,color:"#0F172A",marginBottom:2}}>📊 Dashboard Gerencia</div>
      <div style={{fontSize:11,color:"#64748B",marginBottom:16}}>Vista ejecutiva · {thisYear}</div>

      <div style={card}>
        <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:10}}>Embudo Actual</div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {VENDEDORES_DASH.map(v=>(
            <button key={v.id} onClick={()=>setEmbFiltro(v.id)} style={{
              padding:"4px 10px",borderRadius:20,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",
              background:embFiltro===v.id?"#6366F1":"#F1F5F9",
              color:embFiltro===v.id?"white":"#64748B",
            }}>{v.name}</button>
          ))}
        </div>
        {ESTADOS_EMBUDO.map(e=>{
          const count=getEmbCount(e);
          const pct=Math.round((count/maxEmb)*100);
          return(
            <div key={e.key} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:11,color:"#475569"}}>{e.label}</span>
                <span style={{fontSize:11,fontWeight:700,color:"#0F172A"}}>{count.toLocaleString()}</span>
              </div>
              <div style={{height:7,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:pct+"%",background:e.color,borderRadius:4,transition:"width 0.3s"}}/>
              </div>
            </div>
          );
        })}
        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F1F5F9",display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"#64748B"}}>Total en embudo</span>
          <span style={{fontSize:13,fontWeight:800,color:"#7C3AED"}}>{filtrados.length.toLocaleString()}</span>
        </div>
      </div>

      <div style={{display:"flex",background:"#F1F5F9",borderRadius:10,padding:3,marginBottom:12}}>
        {[["semanal","🗓️ Esta Semana"],["mensual","📅 Por Mes"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px",background:tab===t?"white":"transparent",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",color:tab===t?"#0F172A":"#94A3B8"}}>{l}</button>
        ))}
      </div>

      {tab==="semanal"&&(
        <div style={card}>
          <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:12}}>Actividad de la Semana</div>
          {vends.map(v=>{
            const m=getMetricasSemana(v.id);
            return(
              <div key={v.id} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #F1F5F9"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>👤 {v.name}</div>
                <div style={{display:"flex",gap:5}}>
                  <MetChip val={m.seguimientos} icon="📞" label="Seguim." color="#6366F1"/>
                  <MetChip val={m.visitas} icon="🏥" label="Visitas" color="#10B981"/>
                  <MetChip val={m.primerPedido} icon="🎉" label="1er Pedido" color="#EC4899"/>
                  <MetChip val={m.descartados} icon="🗑️" label="Descart." color="#EF4444"/>
                  <MetChip val={m.clientes} icon="⭐" label="Clientes" color="#F59E0B"/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab==="mensual"&&(
        <div style={card}>
          <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:12}}>Primer Pedido — Mensual {thisYear}</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{borderBottom:"2px solid #E2E8F0"}}>
                  <th style={{textAlign:"left",padding:"6px 4px",color:"#64748B"}}>Mes</th>
                  <th style={{textAlign:"right",padding:"6px 4px",color:"#64748B"}}>Total</th>
                  {vends.map(v=><th key={v.id} style={{textAlign:"right",padding:"6px 4px",color:"#64748B"}}>{v.name.split(" ")[0]}</th>)}
                  <th style={{textAlign:"right",padding:"6px 4px",color:"#64748B"}}>vs mes ant.</th>
                  <th style={{textAlign:"right",padding:"6px 4px",color:"#64748B"}}>vs año ant.</th>
                </tr>
              </thead>
              <tbody>
                {months.map(({label,m})=>{
                  const curr=getCountMes("total",m,thisYear);
                  const prevM=m>0?getCountMes("total",m-1,thisYear):0;
                  const prevY=getCountMes("total",m,thisYear-1);
                  const gM=calcG(curr,prevM);
                  const gY=calcG(curr,prevY);
                  return(
                    <tr key={m} style={{borderBottom:"1px solid #F1F5F9",background:m===thisMonth?"#F5F3FF":"white"}}>
                      <td style={{padding:"7px 4px",fontWeight:m===thisMonth?700:400,color:"#0F172A"}}>{label}{m===thisMonth?" ◀":""}</td>
                      <td style={{textAlign:"right",padding:"7px 4px",fontWeight:700,color:"#0F172A"}}>{curr}</td>
                      {vends.map(v=><td key={v.id} style={{textAlign:"right",padding:"7px 4px",color:"#475569"}}>{getCountMes(v.id,m,thisYear)}</td>)}
                      <td style={{textAlign:"right",padding:"7px 4px",fontWeight:600,color:gM.startsWith("+")||gM==="nuevo"?"#10B981":gM==="–"?"#94A3B8":"#EF4444"}}>{gM}</td>
                      <td style={{textAlign:"right",padding:"7px 4px",fontWeight:600,color:gY.startsWith("+")||gY==="nuevo"?"#10B981":gY==="–"?"#94A3B8":"#EF4444"}}>{gY}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardVendedor({prospectos,interactionLogs}){
  const myProspectos=prospectos.filter(p=>prospectBelongsToVendor(p,CONFIG_USER.id));
  const now=new Date();
  const today=now.toISOString().split("T")[0];
  const weekStart=new Date(now);
  weekStart.setDate(now.getDate()-now.getDay()+1);
  const weekStartStr=weekStart.toISOString().split("T")[0];

  const segHoy=countContactInteractions(interactionLogs,{
    vendorId:CONFIG_USER.id,
    fechaMin:today,
    fechaMax:today,
  });

  const segSemana=countContactInteractions(interactionLogs,{
    vendorId:CONFIG_USER.id,
    fechaMin:weekStartStr,
  });

  const darSeguimientoCount=myProspectos.filter(p=>isDarSeguimiento(p)).length;

  const ESTADOS=[
    {key:"NUEVO",label:"Nuevos",color:"#94A3B8",countFn:p=>p.estado==="NUEVO"},
    {key:"DAR_SEGUIMIENTO",label:"Dar Seguimiento",color:"#F59E0B",countFn:p=>isDarSeguimiento(p)},
    {key:"CITA_AGENDADA",label:"Citas Agendadas",color:"#8B5CF6",countFn:p=>p.estado==="CITA_AGENDADA"},
    {key:"PRIMER_PEDIDO",label:"Primer Pedido",color:"#EC4899",countFn:p=>p.estado==="PRIMER_PEDIDO"},
    {key:"CLIENTE_ACTIVO",label:"Clientes Activos",color:"#10B981",countFn:p=>p.estado==="CLIENTE_ACTIVO"},
  ];

  const card={background:"white",borderRadius:12,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"};

  return(
    <div style={{height:"100%",overflowY:"auto",background:"#F8FAFC",padding:"16px"}}>
      <div style={{fontSize:18,fontWeight:800,color:"#0F172A",marginBottom:2}}>📊 Mi Dashboard</div>
      <div style={{fontSize:11,color:"#64748B",marginBottom:16}}>
        {CONFIG_USER.name} · {now.toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}
      </div>

      <div style={card}>
        <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:12}}>📞 Mis Seguimientos</div>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1,background:"#EFF6FF",borderRadius:10,padding:"14px",textAlign:"center",border:"1px solid #BFDBFE"}}>
            <div style={{fontSize:28,fontWeight:800,color:"#1D4ED8"}}>{segHoy}</div>
            <div style={{fontSize:11,color:"#3B82F6",marginTop:4,fontWeight:600}}>Hoy</div>
            <div style={{fontSize:9,color:"#64748B",marginTop:2}}>Llamadas + WhatsApp</div>
          </div>
          <div style={{flex:1,background:"#F5F3FF",borderRadius:10,padding:"14px",textAlign:"center",border:"1px solid #DDD6FE"}}>
            <div style={{fontSize:28,fontWeight:800,color:"#6D28D9"}}>{segSemana}</div>
            <div style={{fontSize:11,color:"#7C3AED",marginTop:4,fontWeight:600}}>Esta Semana</div>
            <div style={{fontSize:9,color:"#64748B",marginTop:2}}>Llamadas + WhatsApp</div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:12}}>✅ Dar Seguimiento</div>
        <div style={{background:"#FFFBEB",borderRadius:10,padding:"14px",textAlign:"center",border:"1px solid #FDE68A"}}>
          <div style={{fontSize:32,fontWeight:800,color:"#D97706"}}>{darSeguimientoCount}</div>
          <div style={{fontSize:11,color:"#92400E",marginTop:4,fontWeight:600}}>Prospectos con próxima acción</div>
          <div style={{fontSize:9,color:"#64748B",marginTop:2}}>Interesado, lo piensa, llamada, visita…</div>
        </div>
      </div>

      <div style={card}>
        <div style={{fontSize:13,fontWeight:700,color:"#0F172A",marginBottom:12}}>Mi Pipeline</div>
        {ESTADOS.map(e=>{
          const count=myProspectos.filter(e.countFn).length;
          const total=myProspectos.length||1;
          return(
            <div key={e.key} style={{marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:11,color:"#475569"}}>{e.label}</span>
                <span style={{fontSize:11,fontWeight:700,color:"#0F172A"}}>{count}</span>
              </div>
              <div style={{height:7,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:Math.round((count/total)*100)+"%",background:e.color,borderRadius:4}}/>
              </div>
            </div>
          );
        })}
        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F1F5F9",display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"#64748B"}}>Total mis prospectos</span>
          <span style={{fontSize:13,fontWeight:800,color:"#7C3AED"}}>{myProspectos.length}</span>
        </div>
      </div>
    </div>
  );
}


function LoginScreen({onLogin}){
  const [idVendedor,setIdVendedor]=useState("");
  const [pin,setPin]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const VENDEDORES_IDS = ["VEND-001","VEND-002","VEND-003","VEND-004","VEND-005"];

  const handleLogin=async()=>{
    if(!idVendedor||!pin){setError("Completa todos los campos");return;}
    setLoading(true);setError("");
    try{
      const session = await loginWithPin(idVendedor, pin);
      sessionStorage.setItem("ag_session", JSON.stringify(session));
      onLogin(session);
    }catch(e){
      setError(e.message||"Error de conexión");
    }
    setLoading(false);
  };

  return(
    <div style={{maxWidth:480,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",fontFamily:"'DM Sans',-apple-system,sans-serif",background:"linear-gradient(135deg,#0F172A 0%,#1E293B 100%)"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px"}}>
        {/* Logo */}
        <div style={{width:72,height:72,background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",borderRadius:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"white",marginBottom:24,boxShadow:"0 8px 32px rgba(14,165,233,0.3)"}}>AG</div>
        <div style={{fontSize:24,fontWeight:800,color:"white",marginBottom:6}}>AltoGrado CRM</div>
        <div style={{fontSize:14,color:"#64748B",marginBottom:40}}>Ingresa tus credenciales</div>

        {/* Form */}
        <div style={{width:"100%",display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={{fontSize:12,color:"#94A3B8",marginBottom:6,display:"block",fontWeight:600}}>ID de Vendedor</label>
            <select value={idVendedor} onChange={e=>setIdVendedor(e.target.value)}
              style={{width:"100%",padding:"14px 16px",background:"#1E293B",border:"1.5px solid #334155",borderRadius:12,fontSize:15,color:"white",outline:"none",boxSizing:"border-box"}}>
              <option value="">Selecciona tu ID...</option>
              {VENDEDORES_IDS.map(id=><option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          <div>
            <label style={{fontSize:12,color:"#94A3B8",marginBottom:6,display:"block",fontWeight:600}}>PIN</label>
            <input type="password" value={pin} onChange={e=>setPin(e.target.value)}
              placeholder="••••" maxLength={6}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              style={{width:"100%",padding:"14px 16px",background:"#1E293B",border:"1.5px solid #334155",borderRadius:12,fontSize:20,color:"white",outline:"none",boxSizing:"border-box",letterSpacing:8,textAlign:"center"}}/>
          </div>

          {error&&<div style={{padding:"10px 14px",background:"#FEE2E2",borderRadius:10,fontSize:13,color:"#DC2626",fontWeight:600,textAlign:"center"}}>{error}</div>}

          <button onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"16px",background:loading?"#334155":"linear-gradient(135deg,#0EA5E9,#8B5CF6)",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:700,cursor:loading?"not-allowed":"pointer",marginTop:8}}>
            {loading?"Verificando...":"Entrar →"}
          </button>
        </div>

        <div style={{marginTop:32,fontSize:12,color:"#475569",textAlign:"center"}}>
          ¿Olvidaste tu PIN? Contacta a tu coordinador.
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────
export default function App(){
  const [session,setSession]=useState(SESSION);

  if(!session) return <LoginScreen onLogin={s=>{SESSION=s;setSession(s);}}/>;

  return <AppMain session={session} onLogout={()=>{sessionStorage.removeItem("ag_session");SESSION=null;setSession(null);}}/>;
}

function AppMain({session,onLogout}){
  // Update global CONFIG_USER when session changes
  CONFIG_USER = { id: session.id_vendedor, name: session.nombre, email: session.email };
  const [view,setView]=useState("mapa");
  const [selected,setSelected]=useState(null);
  const [toast,setToast]=useState(null);
  const [showNotif,setShowNotif]=useState(false);
  const [notifs,setNotifs]=useState([]);
  const [prospectos,setProspectos]=useState(MOCK);
  const [loadingSheet,setLoadingSheet]=useState(false);
  const [sheetError,setSheetError]=useState(null);
  const [sheetInteractionLogs,setSheetInteractionLogs]=useState([]);
  const [interactionVersion,setInteractionVersion]=useState(0);

  const interactionLogs=useMemo(
    ()=>mergeInteractionLogs(sheetInteractionLogs,loadLocalInteractionLogs()),
    [sheetInteractionLogs,interactionVersion]
  );

  const logInteraction=useCallback(async(params)=>{
    const entry=await registerInteraction({
      ...params,
      vendedor:{id:CONFIG_USER.id,name:CONFIG_USER.name},
    });
    setInteractionVersion(v=>v+1);
    return entry;
  },[]);

  useEffect(()=>{
    fetchSheetRange("Log_Seguimiento!A2:H5000")
      .then(data=>setSheetInteractionLogs(parseSheetLogRows(data.values)))
      .catch(()=>setSheetInteractionLogs([]));
  },[session?.id_vendedor,interactionVersion]);

  useEffect(()=>{
    setLoadingSheet(true);
    setSheetError(null);
    fetchSheetRange("Prospectos!A2:AQ")
      .then(data=>{
        const overrides = loadProspectOverrides();
        const rows = (data.values||[]).map(row=>{
          const base = {
          id:           row[0]||"",
          nombre:       row[1]||"",
          doctor:       row[2]||"",
          telefono:     normalizeTel(row[3]),
          email:        row[5]||"",
          direccion:    row[6]||"",
          zona:         row[13]||"",
          estado:       row[15]||"NUEVO",
          ult_contacto: row[17]||"",
          ult_resultado:row[18]||"",
          intentos:     parseFloat(row[19])||0,
          notas:        row[20]||"",
          ...resolveVendorFieldsFromSheet(row[21], row[22]),
          waOptIn:      row[23]==="TRUE"||row[23]===true,
          waNumero:     normalizeTel(row[24]),
          labActual:    row[25]||"",
          especialidad: row[29]||"",
          fechaVisita:  row[30]||"",
          resultadoVisita:row[31]||"",
          proximaAccion:normalizeSheetDate(row[32]||""),
          tipoAccion:   row[33]||"",
          esCliente:    row[37]||"",
          seguimiento:  row[41]==="YES"||row[41]==="TRUE",
          tipoTrabajo:  row[39]||"",
          cuentaPrimerPedido: row[38]||"",
          fechaPrimerPedido: row[26]||"",
          fechaUltimoPedido: row[27]||"",
          facturacion:  row[28]||"",
          fechaCompromiso:row[42]||"",
          score:        parseFloat(row[12])||0,
          objecion:     "",
          clinicaDigital:"",
          fechaCita:    normalizeSheetDate(row[32]||""),
          horaCita:     parseHoraFromSheetRow(row),
        };
          return mergeProspectWithOverrides(base, overrides);
        }).filter(r=>r.id&&r.nombre);
        setProspectos(rows);
        setLoadingSheet(false);
        console.debug(`Cargados ${rows.length} prospectos del Sheet`);

        // Generate dynamic notifications
        try {
          const today = new Date().toISOString().split("T")[0];
          const vendorId = CONFIG_USER.id;
          const generated = [];
          rows.forEach(p => {
            const isMyProspecto = prospectBelongsToVendor(p, vendorId);
            if (!isMyProspecto) return;
            // Citas agendadas
            if (p.estado==="CITA_AGENDADA" && p.proximaAccion) {
              const isToday = p.proximaAccion === today;
              const isFuture = p.proximaAccion > today;
              if (isToday || isFuture) {
                generated.push({
                  id: `cita-${p.id}`,
                  icon: "📅",
                  title: `Cita — ${p.nombre}`,
                  body: `${p.proximaAccion}${p.horaCita ? " a las " + p.horaCita : ""}`,
                  time: p.proximaAccion,
                  read: false
                });
              }
            }
            // Callbacks para hoy
            if (p.estado==="CALLBACK_SOLICITADO" && p.proximaAccion===today) {
              generated.push({
                id: `cb-${p.id}`,
                icon: "📞",
                title: `Callback hoy — ${p.nombre}`,
                body: `El doctor pidió que lo llamen hoy`,
                time: today,
                read: false
              });
            }
            // Seguimientos vencidos o de hoy
            if (["VISITADO_INTERESADO","TRANSFERIDO_TECNICO"].includes(p.estado) && !p.seguimiento && p.proximaAccion && p.proximaAccion <= today) {
              generated.push({
                id: `seg-${p.id}`,
                icon: "✅",
                title: `Seguimiento — ${p.nombre}`,
                body: `${p.tipoAccion||"LLAMADA"} · ${p.proximaAccion}`,
                time: p.proximaAccion,
                read: p.proximaAccion < today
              });
            }
          });
          generated.sort((a,b) => b.time.localeCompare(a.time));
          setNotifs(generated.slice(0, 20));
        } catch(e) {
          console.log("Notifs generation skipped:", e.message);
        }
      })
      .catch(e=>{
        console.debug("Sheet no disponible, usando mock:", e.message);
        setSheetError(e.message||"Error de conexión al Sheet");
        setLoadingSheet(false);
      });
  },[session?.id_vendedor]);

  const [sistemaActivo,setSistemaActivo]=useState(true);
  const [plan,setPlan]=useState(INIT_PLAN);

  // Load Plan Semanal from Sheet into AppMain so all views can access it
  useEffect(()=>{
    const currentVendorId = CONFIG_USER.id||"";
    if(!currentVendorId) return;
    fetchSheetRange("Plan Semanal!A2:R50").then(data=>{
      const planData={...INIT_PLAN};
      (data.values||[]).forEach(row=>{
        const planKey=row[17]||"";
        const semana=row[1]||"";
        const idVend=row[3]||"";
        if(!planKey||![W0,W1,W2].includes(semana)||idVend!==currentVendorId) return;
        planData[semana]={
          semana,
          LUNES:row[4]||"",MARTES:row[5]||"",
          "MIÉRCOLES":row[6]||"",JUEVES:row[7]||"",VIERNES:row[8]||"",
          locked:semana===W0,
        };
      });
      setPlan(planData);
    }).catch(()=>{});
  },[session?.id_vendedor]);

  // Load sistema status from sheet on mount
  useEffect(()=>{
    fetchSheetRange("Vendedores!A2:K20").then(data=>{
      const vend=(data.values||[]).find(r=>r[0]===CONFIG_USER.id);
      if(vend) setSistemaActivo(vend[9]==="TRUE"||vend[9]===true||vend[9]==="true");
    }).catch(()=>{});
  },[session?.id_vendedor]);

  const toggleSistema=async()=>{
    const nuevoEstado=!sistemaActivo;
    setSistemaActivo(nuevoEstado);
    try{
      await postMake("e7",{accion:"pausar_sistema",id_vendedor:CONFIG_USER.id,activo:nuevoEstado});
      showToast(nuevoEstado?"✅ Sistema de llamadas activado":"⏸️ Sistema pausado",nuevoEstado?"success":"warning");
    }catch(e){showToast("Error al actualizar","error");}
  };

  const unread=notifs.filter(n=>!n.read).length;
  const citasHoy=prospectos.filter(p=>p.estado==="CITA_AGENDADA"&&getFechaCita(p)===fmt(today)&&prospectBelongsToVendor(p,session.id_vendedor)).length;
  const checkCount=prospectos.filter(p=>isDarSeguimiento(p)&&!p.seguimiento&&prospectBelongsToVendor(p,session.id_vendedor)).length;

  const showToast=useCallback((msg,type="info")=>setToast({message:msg,type}),[]);
  const addNotif=useCallback(n=>setNotifs(prev=>[n,...prev]),[]);
  const updateP=useCallback((id,u)=>{
    saveProspectOverride(id,u);
    setProspectos(prev=>prev.map(p=>p.id===id?enrichProspectFromSheet({...p,...u}):p));
  },[]);
  const dismissN=useCallback(id=>setNotifs(prev=>prev.filter(n=>n.id!==id)),[]);

  // Request push notification permission
  useEffect(()=>{
    if("Notification" in window && Notification.permission==="default"){
      setTimeout(()=>Notification.requestPermission(),2000);
    }
  },[]);

  const VIEWS=[
    {id:"mapa",icon:"🗺️",label:"Hoy",badge:citasHoy},
    {id:"lista",icon:"📋",label:"Lista"},
    {id:"checklist",icon:"✅",label:"Check",badge:checkCount},
    {id:"plan",icon:"📅",label:"Plan"},
    {id:"nueva",icon:"➕",label:"Nueva"},
    {id:"dashboard",icon:"📊",label:"Dash"},
  ];

  return(
    <div style={{maxWidth:480,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",fontFamily:"'DM Sans','SF Pro Display',-apple-system,sans-serif",backgroundColor:"#F8FAFC",position:"relative",overflow:"hidden"}}>
      
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0F172A 0%,#1E293B 100%)",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:"white"}}>AG</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"white"}}>AltoGrado CRM</div>
            <div style={{fontSize:11,color:"#64748B"}}>
              {loadingSheet?"⏳ Cargando datos...":sheetError?`⚠️ ${sheetError}`:view==="mapa"?`${citasHoy} citas hoy`:view==="lista"?`${prospectos.filter(p=>p.estado!=="CLIENTE_ACTIVO").length} prospectos`:view==="checklist"?`${checkCount} pendientes`:view==="plan"?"Plan semanal":"Nueva clínica"}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setShowNotif(true)} style={{position:"relative",background:"none",border:"none",cursor:"pointer",padding:4}}>
            <span style={{fontSize:22}}>🔔</span>
            {unread>0&&<span style={{position:"absolute",top:0,right:0,background:"#EF4444",color:"white",borderRadius:10,fontSize:9,fontWeight:700,padding:"1px 5px",minWidth:14,textAlign:"center"}}>{unread}</span>}
          </button>
          <button onClick={onLogout} title="Cerrar sesión" style={{background:"none",border:"none",cursor:"pointer",padding:4}}>
            <Avatar name={CONFIG_USER.name} size={34}/>
          </button>
          <button onClick={toggleSistema} title={sistemaActivo?"Pausar sistema":"Activar sistema"} style={{background:sistemaActivo?"#10B981":"#EF4444",border:"none",borderRadius:20,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10,fontWeight:700,color:"white"}}>{sistemaActivo?"🤖 ON":"⏸️ OFF"}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflow:"hidden"}}>
        {view==="mapa"&&<MapaDelDia prospectos={prospectos} onSelect={setSelected} onToast={showToast} addNotif={addNotif} plan={plan} vendorId={session.id_vendedor}/>}
        {view==="lista"&&<ListaDelDia prospectos={prospectos} onSelect={setSelected} vendorId={CONFIG_USER.id}/>}
        {view==="checklist"&&<Checklist prospectos={prospectos} onSelect={setSelected} onUpdate={updateP} onToast={showToast} vendorId={CONFIG_USER.id} onLogInteraction={logInteraction}/>}
        {view==="plan"&&<PlanSemanal prospectos={prospectos} onToast={showToast} plan={plan} setPlan={setPlan}/>}
        {view==="nueva"&&<NuevaClinica onToast={showToast} addNotif={addNotif} prospectos={prospectos}/>}
        {view==="dashboard"&&(["VEND-002","VEND-004","VEND-005"].includes(CONFIG_USER.id)?
          <DashboardGerencia prospectos={prospectos} interactionLogs={interactionLogs}/>:
          <DashboardVendedor prospectos={prospectos} interactionLogs={interactionLogs}/>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{display:"flex",background:"white",borderTop:"1px solid #F1F5F9",paddingBottom:"env(safe-area-inset-bottom,0px)",flexShrink:0}}>
        {VIEWS.map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,position:"relative"}}>
            <div style={{position:"relative"}}>
              <span style={{fontSize:20}}>{v.icon}</span>
              {v.badge>0&&<span style={{position:"absolute",top:-4,right:-8,background:"#EF4444",color:"white",borderRadius:10,fontSize:9,fontWeight:700,padding:"1px 5px",minWidth:14,textAlign:"center"}}>{v.badge}</span>}
            </div>
            <span style={{fontSize:9,fontWeight:view===v.id?700:500,color:view===v.id?"#0EA5E9":"#94A3B8"}}>{v.label}</span>
            {view===v.id&&<div style={{position:"absolute",top:0,left:"20%",right:"20%",height:2,background:"#0EA5E9",borderRadius:"0 0 2px 2px"}}/>}
          </button>
        ))}
      </div>

      {selected&&<ProspectoModal p={selected} onClose={()=>setSelected(null)} onUpdate={updateP} onToast={showToast} plan={INIT_PLAN[W0]} addNotif={addNotif} onLogInteraction={logInteraction}/>}
      {showNotif&&<NotifPanel notifications={notifs} onDismiss={dismissN} onClose={()=>setShowNotif(false)}/>}
      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap');
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        body{margin:0;background:#F8FAFC;overflow:hidden;}
        @keyframes slideUp{from{transform:translate(-50%,20px);opacity:0;}to{transform:translate(-50%,0);opacity:1;}}
        ::-webkit-scrollbar{width:0;}
        select,input,textarea{-webkit-appearance:none;font-family:inherit;}
      `}</style>
    </div>
  );
}
