import type { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"

/**
 * Standard dialog presentation size across all custom plugin modals.
 */
export const DIALOG_SIZE = "large" as const

/**
 * Presentation props for the standard DialogShell.
 */
export interface DialogShellProps {
  title: string
  colors: {
    base: RGBA
    muted: RGBA
  }
  onClose: () => void
  paddingX?: number
  children?: JSX.Element
}

/**
 * Standard outer dialog shell for all plugin-owned modal dialogs.
 *
 * Enforces unified padding, horizontal spacing, and header layout.
 */
export function DialogShell(props: DialogShellProps): JSX.Element {
  return (
    <box
      flexDirection="column"
      paddingLeft={props.paddingX ?? 4}
      paddingRight={props.paddingX ?? 4}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.base}>
          <b>{props.title}</b>
        </text>
        <text fg={props.colors.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      {props.children}
    </box>
  )
}
