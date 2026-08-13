import {
  CaretDown,
  CheckCircle,
  Cube,
  DotsThreeVertical,
  Eye,
  FileText,
  Folder,
  Gear,
  Image,
  Info,
  Question,
  SlidersHorizontal,
  ArrowCounterClockwise,
  ShareNetwork,
  Warning,
  X,
  type IconProps,
} from "@phosphor-icons/react";

const defaults: IconProps = { "aria-hidden": true, weight: "regular" };

export const FolderIcon = (props: IconProps) => <Folder {...defaults} {...props} />;
export const GearIcon = (props: IconProps) => <Gear {...defaults} {...props} />;
export const HelpIcon = (props: IconProps) => <Question {...defaults} {...props} />;
export const InfoIcon = (props: IconProps) => <Info {...defaults} {...props} />;
export const RestartIcon = (props: IconProps) => <ArrowCounterClockwise {...defaults} {...props} />;
export const ShareIcon = (props: IconProps) => <ShareNetwork {...defaults} {...props} />;
export const DocumentIcon = (props: IconProps) => <FileText {...defaults} {...props} />;
export const WarningIcon = (props: IconProps) => <Warning {...defaults} {...props} />;
export const CubeIcon = (props: IconProps) => <Cube {...defaults} {...props} />;
export const CloseIcon = (props: IconProps) => <X {...defaults} {...props} />;
export const ChevronIcon = (props: IconProps) => <CaretDown {...defaults} {...props} />;
export const MoreIcon = (props: IconProps) => <DotsThreeVertical {...defaults} {...props} />;
export const ImageIcon = (props: IconProps) => <Image {...defaults} {...props} />;
export const ReviewIcon = (props: IconProps) => <Eye {...defaults} {...props} />;
export const SettingsIcon = (props: IconProps) => <SlidersHorizontal {...defaults} {...props} />;
export const ConfirmIcon = (props: IconProps) => <CheckCircle {...defaults} {...props} />;
