# CLAUDE.md

Prueba técnica para Grenergy, cargo Data & AI Engineer. Plazo de entrega sábado 29 de agosto de 2026 en la noche (hora Chile). Objetivo de entrega interna: viernes 28 en la noche.

Lee BRIEF.md antes de hacer cualquier cosa. Ahí están el problema, las decisiones cerradas y el plan por fases. Este archivo son las reglas de trabajo.

## Cómo trabajamos

Julio define alcance y ratifica decisiones. El agente ejecuta por fases. Cada fase termina con un reporte corto con este formato fijo:

1. Qué se ejecutó.
2. Hallazgos que divergen del plan.
3. Decisiones que necesito de Julio.
4. Deudas nuevas.

No se avanza a la fase siguiente sin que Julio diga que sí. Si una premisa no se puede verificar con evidencia (una llamada real a la API, un archivo, una doc oficial), se declara como hipótesis, no como hecho.

Cuando haya una decisión de producto o arquitectura abierta, se presenta en lenguaje de negocio con opciones y tradeoffs. No se elige por el usuario.

## Secretos

Regla sin excepciones. Nunca en el repo:

- El token de ENTSO-E.
- El usuario y contraseña de Fabric.
- El secreto HMAC de publicación.
- Las keys de Supabase, Vercel o cualquier API key.

Van en `.env` (ignorado por git) y en `.env.example` con valores vacíos. Dentro de Fabric van en la Biblioteca de variables del workspace. Antes de cada commit se corre el escáner de secretos. Si un secreto llega a un commit, se avisa de inmediato, no se intenta ocultar con un rebase.

## Datos y pipeline

- Toda tabla de precios tiene clave única (country_code, ts_utc). Toda escritura es upsert idempotente. Correr dos veces el mismo día produce el mismo resultado.
- Los timestamps se guardan en UTC siempre. La fecha de negocio local se guarda aparte como columna (business_date_local) porque los mercados publican por día local.
- Cada fila guarda la moneda original, el precio original, el precio en EUR, la tasa usada y la fecha de la tasa. Nada se sobreescribe sin trazabilidad.
- Nada hardcodeado por país. Agregar un país es agregar una fila en la tabla de configuración de fuentes.
- Los huecos se detectan calculando los slots esperados por día y granularidad (96 para PT15M, 24 para PT60M, y 92 o 100 o 23 o 25 en días de cambio de hora). Un día incompleto se reintenta, no se marca como cargado.
- ENTSO-E omite posiciones cuando el precio no cambia respecto a la anterior (curveType A03). Eso no es un hueco, es forward fill por posición. No confundir las dos cosas.

## Código

- Fabric: Python en notebooks. Las funciones de parseo y transformación viven en un módulo puro (sin Spark, sin I/O) que se pueda testear local con pytest. El notebook solo orquesta.
- API e interfaz: TypeScript. Express para la API, React con Vite para la interfaz, Supabase Postgres como capa de servicio, Vercel para desplegar. Es el stack conocido, no se cambia.
- El lector de datos de la API va detrás de una interfaz con dos adaptadores, postgres (activo) y fabric-graphql (implementado hasta donde se pueda sin credenciales, documentado). Se elige por variable de entorno.
- Toda lectura remota en la interfaz distingue cinco estados: cargando, vacío, error de fetch, sin permiso, desactualizado. Vacío solo se muestra después de una respuesta exitosa.
- Tests para lo que tiene lógica. Parseo de cada API, forward fill de ENTSO-E, selección de bloque de SMARD, conversión PLN a EUR, detección de huecos, resample PT15M a PT60M, firma HMAC.
- Migraciones SQL idempotentes, escritas a mano, en carpeta `/db/migrations`.

## Git

- Trabajo en rama feature, merge a main por PR.
- Commits chicos, mensaje en español o inglés pero consistente dentro del repo. Preferimos inglés porque el README y la documentación de las APIs están en inglés.
- El README y el documento técnico van en español. Los lee un equipo en España y Chile.

## Interfaz

- Usa el design system de Relevo Studio que está en `/design/relevo-design-system.html`. Colores, tipografía, espaciado, componentes. Sin logo ni nombre Relevo en ninguna parte. El nombre del producto lo define Julio.
- Sin librerías de componentes externas más allá de lo que el design system ya usa.

## Documentación

El README se escribe al final pero se van dejando notas de decisiones en `/docs/decisions.md` a medida que aparecen. Cada decisión con contexto, opciones consideradas y por qué se eligió una. Ese archivo es la fuente del documento técnico final.

El README lo redacta Julio con su estilo. El agente entrega el contenido técnico ordenado, no el texto final.

## Qué no hacer

- No usar usuario y contraseña de Fabric desde ningún servidor externo.
- No agregar países o fuentes que no estén en la prueba salvo que Julio lo pida.
- No sobreingeniería. Sin colas externas, sin Kubernetes, sin microservicios. Cuatro países y 96 filas al día por país.
- No inventar datos de prueba que parezcan reales. Si una API no responde, se documenta.
