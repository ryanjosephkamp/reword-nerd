import { WorkspaceProvider } from "../workspace/Workspace";
import type { WorkbenchServices } from "./workbench/contracts";
import { Workbench } from "./workbench/Workbench";
import { UnifiedPlatform } from "./platform/UnifiedPlatform";
export function App({ services }: { services?: WorkbenchServices }) {
  return services ? <Workbench services={services} /> : <WorkspaceProvider><UnifiedPlatform /></WorkspaceProvider>;
}
