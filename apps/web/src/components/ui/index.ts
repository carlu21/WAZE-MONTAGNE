/**
 * Design system Mountain Live — point d'entrée unique.
 * Voir docs/DESIGN_SYSTEM.md pour les principes, tokens et exemples.
 */
export { cn, type ClassValue } from "./cn";
export * from "./hooks";
export * from "./icons";

export { Button, LinkButton, IconButton, Fab, buttonClasses } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonStyleProps, LinkButtonProps, IconButtonProps, IconButtonSize, IconButtonVariant, FabProps } from "./Button";

export { BottomSheet, SHEET_SNAPS } from "./BottomSheet";
export type { BottomSheetProps, SheetSnap } from "./BottomSheet";
export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";
export { Drawer } from "./Drawer";
export type { DrawerProps } from "./Drawer";

export { TopBar, SearchField } from "./TopBar";
export type { TopBarProps, SearchFieldProps } from "./TopBar";

export { Chip } from "./Chip";
export type { ChipProps } from "./Chip";
export { Segmented } from "./Segmented";
export type { SegmentedProps, SegmentedOption } from "./Segmented";
export { Toggle } from "./Toggle";
export type { ToggleProps } from "./Toggle";
export { Field, FieldContext, useFieldControl } from "./Field";
export type { FieldProps, FieldContextValue, FieldControlProps } from "./Field";
export { Input, INPUT_CLASSES } from "./Input";
export type { InputProps } from "./Input";
export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";
export { Select } from "./Select";
export type { SelectProps, SelectOption } from "./Select";
export { Slider } from "./Slider";
export type { SliderProps, SliderMark } from "./Slider";

export { Card, CardHeader } from "./Card";
export type { CardProps, CardHeaderProps, CardTone } from "./Card";
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
export { Badge, SourceBadge, ConfidenceBadge, DangerPill, StatusPill } from "./Badge";
export type { BadgeProps, BadgeTone, BadgeSize, SourceBadgeProps, ConfidenceBadgeProps, DangerPillProps, StatusPillProps } from "./Badge";
export { CategoryIcon, iconNameFor } from "./CategoryIcon";
export type { CategoryIconProps } from "./CategoryIcon";
export { CategoryTile, SubtypeTile } from "./CategoryTile";
export type { CategoryTileProps, SubtypeTileProps } from "./CategoryTile";

export { Banner } from "./Banner";
export type { BannerProps, BannerTone } from "./Banner";
export { ToastProvider, ToastViewport, useToast } from "./Toast";
export type { ToastProviderProps } from "./Toast";
export { toast, useToasts, TOAST_DURATIONS, TOAST_MAX } from "@/lib/toast";
export type { ToastApi, ToastItem, ToastOptions, ToastTone, ToastAction } from "@/lib/toast";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { Skeleton, SkeletonText, SkeletonListItem, SkeletonGroup } from "./Skeleton";
export type { SkeletonProps, SkeletonTextProps, SkeletonGroupProps } from "./Skeleton";
export { PageLoader } from "./PageLoader";
export type { PageLoaderProps } from "./PageLoader";
export { Divider } from "./Divider";
export type { DividerProps } from "./Divider";
export { SafetyNotice } from "./SafetyNotice";
export type { SafetyNoticeProps } from "./SafetyNotice";
export { RelativeTime } from "./RelativeTime";
export type { RelativeTimeProps } from "./RelativeTime";
export { Distance } from "./Distance";
export type { DistanceProps } from "./Distance";
export { Avatar, avatarColor, AVATAR_COLORS } from "./Avatar";
export type { AvatarProps, AvatarSize } from "./Avatar";
export { BadgeIcon } from "./BadgeIcon";
export type { BadgeIconProps } from "./BadgeIcon";
export { Stat } from "./Stat";
export type { StatProps } from "./Stat";
export { ReliabilityLevel, clampLevel, RELIABILITY_MAX } from "./ReliabilityLevel";
export type { ReliabilityLevelProps } from "./ReliabilityLevel";
