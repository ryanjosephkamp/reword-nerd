import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...props}>{children}</svg>;
}

export const FolderIcon = (props: IconProps) => <Icon {...props}><path d="M3 6h7l2 2h9v11H3z" /></Icon>;
export const GearIcon = (props: IconProps) => <Icon {...props}><path d="M9.5 3h5l.7 2.1 2 .8 2-1 2.5 3.9-1.6 1.6.2 2.1 1.8 1.5-2 4.3-2.4-.5-1.7 1.3-.2 2.2h-5l-.7-2.1-2-.8-2 1-2.5-3.9 1.6-1.6-.2-2.1-1.8-1.5 2-4.3 2.4.5 1.7-1.3z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const HelpIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.1 2.2c-.9.4-.9 1-.9 1.8M12 16.5h.01" /></Icon>;
export const DocumentIcon = (props: IconProps) => <Icon {...props}><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 11h6M9 15h6" /></Icon>;
export const WarningIcon = (props: IconProps) => <Icon {...props}><path d="M12 3 2.5 21h19zM12 9v5M12 17.5h.01" /></Icon>;
export const CubeIcon = (props: IconProps) => <Icon {...props}><path d="m12 2 8 4.5v10L12 22l-8-5.5v-10zM4 6.5l8 5 8-5M12 11.5V22" /></Icon>;
export const CloseIcon = (props: IconProps) => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const ChevronIcon = (props: IconProps) => <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>;
export const MoreIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></Icon>;
