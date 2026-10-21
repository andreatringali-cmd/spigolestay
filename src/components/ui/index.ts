// Componenti base del design system Xenora (DS 1). Importa da qui: `import { Button, Field, Input, Modal } from "@/components/ui/index"`.
// (`@/components/ui` risolve al file ui.tsx — PageHeader, Card, StatCard — che a sua volta ri-esporta questo indice.)
export { cn } from "./cn";
export { Spinner } from "./Spinner";
export { Button, IconButton, buttonClass, BUTTON_VARIANT, type ButtonProps, type ButtonSize } from "./Button";
export { Field, Input, Select, Textarea, useFieldControl, inputClass, FIELD_CONTROL, type FieldProps, type InputProps, type SelectProps, type TextareaProps } from "./Field";
export { Badge, type BadgeProps, type BadgeTone, type BadgeSize } from "./Badge";
export { Modal, ModalView, type ModalProps, type ModalSize } from "./Modal";
export { Tabs, TabPanel, tabId, panelId, type TabsProps, type TabItem } from "./Tabs";
export { Switch, type SwitchProps } from "./Switch";
export { DataTable, type DataTableProps, type DataColumn } from "./DataTable";
export { Alert, ToastView, type AlertProps, type AlertTone } from "./Toast";
