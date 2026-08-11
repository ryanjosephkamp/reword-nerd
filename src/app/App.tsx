import type { WorkbenchServices } from "./workbench/contracts";
import { Workbench } from "./workbench/Workbench";

export function App({ services }: { services?: WorkbenchServices }) {
  return <Workbench services={services} />;
}
