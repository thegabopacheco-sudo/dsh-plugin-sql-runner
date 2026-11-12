# dsh-plugin-sql-runner — SQL Runner

Ejecuta consultas SQL sobre SQLite local (node:sqlite): lista tablas, SELECT con limite y escrituras solo con confirmacion y rutas permitidas.

## Herramientas

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `tables` | Listar tablas |
| `query` | Ejecutar SQL |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-sql-runner` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-sql-runner
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_SQL_RUNNER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\sql-runner\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
