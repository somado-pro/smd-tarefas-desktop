import{q as e,ag as r}from"./index-l_dz2g0M.js";import{B as d}from"./breadcrumb-CzBCfgyK.js";function c(){return e.jsxs("div",{children:[e.jsx(d,{items:[{label:"API docs",icon:e.jsx(r,{className:"h-3 w-3"})}]}),e.jsxs("div",{className:"max-w-3xl mx-auto p-6 md:p-8 prose-doc",children:[e.jsx("h1",{className:"text-2xl font-semibold mb-2",children:"API docs"}),e.jsxs("p",{className:"text-sm text-muted-foreground mb-6",children:["Use API tokens (criados em ",e.jsx("a",{href:"/settings",className:"text-blue-400 hover:underline",children:"/settings → Integrações"}),") pra autenticar. Sempre envie no header ",e.jsx("code",{children:"Authorization: Bearer <token>"}),"."]}),e.jsxs(s,{title:"GET /api/v1/tasks",children:[e.jsx("p",{className:"text-sm",children:"Lista tasks de uma lista."}),e.jsx(t,{children:`curl https://seu-dominio.com/api/v1/tasks?list_id=<uuid> \\
  -H "Authorization: Bearer SEU_TOKEN"`}),e.jsxs("p",{className:"text-xs text-muted-foreground",children:["Retorna: ",e.jsx("code",{children:"{ tasks: Task[] }"})]})]}),e.jsxs(s,{title:"POST /api/v1/tasks",children:[e.jsx("p",{className:"text-sm",children:"Cria uma task."}),e.jsx(t,{children:`curl -X POST https://seu-dominio.com/api/v1/tasks \\
  -H "Authorization: Bearer SEU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "list_id": "<uuid>",
    "title": "Nova task",
    "description": "Opcional",
    "priority": "high",
    "assignee_id": "<user-uuid>",
    "due_date": "2026-12-31T00:00:00Z"
  }'`}),e.jsxs("p",{className:"text-xs text-muted-foreground",children:["Retorna: ",e.jsx("code",{children:"{ task: Task }"})," (201)"]})]}),e.jsxs(s,{title:"Webhooks",children:[e.jsxs("p",{className:"text-sm",children:["Configure URLs em ",e.jsx("a",{href:"/settings",className:"text-blue-400 hover:underline",children:"/settings → Integrações"}),". A cada evento, enviamos POST com payload JSON. Header ",e.jsx("code",{children:"X-SMD-Signature"})," traz HMAC-SHA256."]}),e.jsx("p",{className:"text-xs text-muted-foreground mt-3 mb-1 font-medium",children:"Eventos disponíveis:"}),e.jsxs("ul",{className:"text-xs space-y-1",children:[e.jsx("li",{children:e.jsx("code",{children:"task_created"})}),e.jsx("li",{children:e.jsx("code",{children:"task_status_changed"})}),e.jsx("li",{children:e.jsx("code",{children:"task_assigned"})}),e.jsx("li",{children:e.jsx("code",{children:"task_tag_added"})}),e.jsx("li",{children:e.jsx("code",{children:"task_due_date_set"})}),e.jsx("li",{children:e.jsx("code",{children:"task_commented"})}),e.jsxs("li",{children:[e.jsx("code",{children:"test"})," (manual via UI)"]})]}),e.jsx(t,{children:`// Payload exemplo
{
  "event": "task_status_changed",
  "payload": {
    "task_id": "<uuid>",
    "actor_id": "<user-uuid>",
    "before": { "status": "todo" },
    "after": { "status": "done" }
  },
  "ts": 1716230400000
}`}),e.jsxs("p",{className:"text-xs text-muted-foreground",children:["Para validar a origem, calcule HMAC-SHA256 do body cru usando o secret do webhook e compare com ",e.jsx("code",{children:"X-SMD-Signature"})," em hex."]})]}),e.jsx(s,{title:"Códigos de resposta",children:e.jsxs("ul",{className:"text-xs space-y-1",children:[e.jsxs("li",{children:[e.jsx("code",{children:"200/201"})," — sucesso"]}),e.jsxs("li",{children:[e.jsx("code",{children:"400"})," — payload inválido (falta campo obrigatório)"]}),e.jsxs("li",{children:[e.jsx("code",{children:"401"})," — token ausente, inválido ou expirado"]}),e.jsxs("li",{children:[e.jsx("code",{children:"500"})," — erro interno (ver mensagem)"]})]})}),e.jsxs(s,{title:"Cron job: tasks recorrentes",children:[e.jsx("p",{className:"text-sm",children:"Tasks com recorrência são geradas via endpoint cron. Plugue num scheduler externo (Vercel Cron, GitHub Actions, etc):"}),e.jsx(t,{children:`curl https://seu-dominio.com/api/cron/recurring \\
  -H "Authorization: Bearer $CRON_SECRET"`}),e.jsxs("p",{className:"text-xs text-muted-foreground",children:["Configure ",e.jsx("code",{children:"CRON_SECRET"})," nas env vars. Rode 1x por dia."]})]})]})]})}function s({title:i,children:a}){return e.jsxs("section",{className:"mb-8",children:[e.jsx("h2",{className:"text-lg font-semibold mb-2 font-mono",children:i}),e.jsx("div",{className:"space-y-2",children:a})]})}function t({children:i}){return e.jsx("pre",{className:"text-xs bg-muted/40 rounded-md p-3 border overflow-x-auto font-mono whitespace-pre",children:i})}export{c as default};
