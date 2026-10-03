/**
 * dsh-web-tray host entry. Mounts the loopback API that generates the Windows
 * desktop shortcut, the WSL start script, and the Windows tray helper. The
 * browser half registers the matching settings section on its own — current
 * DSH retired the host-registered settings namespace — so every fact the
 * section shows, and the configurable source-project path it writes, flows
 * through the `/dsh-web-tray/*` routes mounted here.
 */
import { DEFAULT_SHORTCUT_NAME } from "./artifacts.js";
import { registerTrayRoutes } from "./routes.js";
import { TrayService } from "./service.js";
export const name = 'dsh-web-tray';
/**
 * Mount the HTTP API the browser section talks to. The section is a client-only
 * contribution; the host owns the generated artifacts and the per-install state
 * behind these routes.
 * @param ctx - Host context that may acquire the webserver service.
 */
export function apply(ctx) {
    ctx.inject(['webServer'], (hostCtx) => {
        const server = hostCtx.webServer;
        const service = new TrayService({ logger: hostCtx.logger }, server, DEFAULT_SHORTCUT_NAME);
        hostCtx.effect(() => registerTrayRoutes(server, service), 'dsh-web-tray: http routes');
        hostCtx.effect(() => {
            // First boot (or a repair after files were deleted) recreates the desktop
            // shortcut without waiting for the user to open the settings section.
            void service.ensure().catch((error) => {
                hostCtx.logger.warn(`[dsh-web-tray] ensure failed: ${error instanceof Error ? error.message : String(error)}`);
            });
            return () => { };
        }, 'dsh-web-tray: initial ensure');
    });
}
