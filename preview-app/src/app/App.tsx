import type { WorkbenchServices } from "./workbench/contracts";
import { Workbench } from "./workbench/Workbench";
import { UnifiedPlatform } from "./platform/UnifiedPlatform";
export function App({ services }: { services?: WorkbenchServices }) {
  return services ? <Workbench services={services} /> : <UnifiedPlatform />;
}
