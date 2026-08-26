# Guía: integración Git del workspace de Fabric

> **Decisión tomada (D23): opción B, el workspace no se conecta a Git.** Esta guía queda como referencia de cómo se haría en Grenergy cuando los secretos vivan en Azure Key Vault y no en la Biblioteca de variables.

Extra mile 5 del BRIEF. Paso a paso en el navegador, con lo que deberías ver al terminar cada paso. Verificado contra la documentación oficial de Fabric (julio 2026); lo marcado **[hipótesis]** no se pudo confirmar sin acceso.

## 0. Decide antes de empezar: qué se versiona y dónde

La integración Git de Fabric versiona **todos** los ítems soportados del workspace; no se puede excluir uno. Entre ellos está la **Biblioteca de variables**, y la documentación es explícita: `variables.json` "contains the variable names and their default values". Es decir, conectar el workspace `Day Ahead Prices - Julio Araya` a un repositorio escribiría en Git `ENTSOE_TOKEN`, `INGEST_HMAC_SECRET` e `INGEST_API_URL` en texto plano.

Eso choca con la regla de CLAUDE.md (ningún secreto en el repo) si el destino es `dayahead-eu-prices`, que es el repo de entrega. Opciones:

| Opción | Qué implica | Recomendación |
|---|---|---|
| **A. Repositorio privado aparte** (`dayahead-eu-prices-fabric`, privado, solo tú) | Se muestra la integración funcionando; los secretos quedan en un repo privado, no en el de entrega. Sigue siendo un secreto en Git: rotar el HMAC después de la prueba y no dar acceso al repo a nadie | La única forma de hacer la demo sin contaminar el repo de entrega |
| **B. No conectar Git** | Se documenta en el documento técnico por qué: el ítem que lleva los secretos no se puede excluir y no hay tipo secreto ni Key Vault sin registro de aplicación (D1) | Segura y defendible; pierde el extra mile |
| C. Conectar al repo de entrega | Publica el token y el secreto | Descartada |

Julio eligió **B** (D23). Lo que sigue describe A, por si en el futuro se hace con los secretos fuera de la biblioteca.

## 1. Prerrequisitos

1. **Tenant** (Admin portal → Tenant settings): deben estar activados "Users can create Fabric items", "Users can synchronize workspace items with their Git repositories" y, para GitHub, **"Users can synchronize workspace items with GitHub repositories"**. Tú no eres admin del tenant de Grenergy: si el último no está activo, la integración con GitHub no aparece o falla al conectar. **[hipótesis]** que estén activados; si no, opción B y se documenta.
2. **Rol**: solo un **Admin del workspace** puede conectar. Con la cuenta de la prueba deberías serlo del workspace que creaste.
3. **GitHub**: crea el repositorio privado `dayahead-eu-prices-fabric` (vacío, sin README) y un **fine-grained personal access token** en https://github.com/settings/personal-access-tokens/new con acceso solo a ese repositorio y permiso **Contents: Read and write**. Guarda el token en tu gestor de contraseñas; se pega una sola vez en Fabric.

## 2. Conectar el workspace

1. Workspace `Day Ahead Prices - Julio Araya` → **Workspace settings → Git integration**.
2. Proveedor: **GitHub** → **Add account**. Display name: `julio-github`; Personal access token: el fine-grained; Repository URL: `https://github.com/Julio-Araya/dayahead-eu-prices-fabric` (al indicar la URL, la cuenta queda limitada a ese repo, que es lo que queremos). **Connect**.
3. Branch: **+ New Branch** → `main` (o `fabric`). Folder: `workspace`.
4. **Connect and sync**. Como el repo está vacío y el workspace tiene ítems, Fabric copia del workspace al repo sin preguntar dirección ("if either the workspace or Git branch is empty, content is copied from the nonempty location to the empty one").

Deberías ver: en el workspace, la barra de Source control con la rama conectada, cada ítem en estado **Synced** y la hora de la última sincronización. En GitHub, la carpeta `workspace/` con un directorio por ítem: `nb_dayahead_ingest.Notebook/`, `pl_dayahead_daily.DataPipeline/`, `lh_dayahead.Lakehouse/`, `vl_dayahead.VariableLibrary/`, cada uno con su `.platform`.

## 3. Qué queda versionado (y qué no)

- **Notebook**: el código como `notebook-content.py` (formato de Fabric con marcadores `# CELL`). Los archivos de la carpeta Resources (el wheel) **[hipótesis]** no se incluyen; el wheel se reconstruye con `fabric/build.py` en el repo de entrega.
- **Pipeline**: `pipeline-content.json` con la actividad y sus parámetros. Compáralo con `fabric/pipeline/pl_dayahead_daily.json` del repo de entrega y, si difiere, actualiza el de referencia.
- **Lakehouse**: solo metadatos (nombre, esquema activado o no). Las tablas y los datos no van a Git.
- **Biblioteca de variables**: `variables.json` con nombres y **valores por defecto**, `settings.json`, `valueSets/`. Aquí van los secretos: por eso el repo es privado.

## 4. Uso diario

- Cambio en Fabric (por ejemplo, editas el notebook): icono **Source control** → pestaña **Changes** → marca los ítems → mensaje → **Commit**. Los ítems pasan a **Synced**.
- Cambio en Git (alguien edita `notebook-content.py`): Fabric avisa; **Source control → Updates → Update all**.
- Si quieres deshacer cambios no commiteados: **Changes → Undo** (borra ítems nuevos de forma permanente; lee el diálogo).

## 5. Verificación

- [ ] En GitHub existe `workspace/vl_dayahead.VariableLibrary/variables.json` y el repositorio es **privado** (Settings → Danger zone dice "This repository is currently private").
- [ ] `git clone` local del repo privado y `grep -r "securityToken\|ENTSOE" workspace/` solo aparece en la biblioteca de variables, no en el notebook.
- [ ] Un cambio trivial en el notebook (un comentario) → Commit → aparece en GitHub → revertir.

## 6. Para el documento técnico

Anota: qué opción elegiste y por qué; que la integración es a nivel de workspace y el mapeo de ítems; que el fuente canónico del módulo sigue siendo `etl/dayahead` en el repo de entrega y el notebook de Fabric solo orquesta; y que en Grenergy el paso siguiente sería sacar los secretos de la biblioteca hacia Azure Key Vault (`notebookutils.credentials.getSecret`) para poder conectar el workspace al repositorio del equipo.
