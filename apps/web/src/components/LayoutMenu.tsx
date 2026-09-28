import { PanelsTopLeft } from "lucide-react";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { PaneVisibility } from "@/hooks/usePaneVisibility";

export function LayoutMenu({
	layout,
	consoleLesson,
}: {
	layout: PaneVisibility;
	consoleLesson: boolean;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger
				aria-label="Layout"
				className="gap-2.5 px-2.5 py-2 text-[12.5px]"
			>
				<PanelsTopLeft className="size-[15px] text-muted-foreground" /> Layout
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="min-w-52">
				<DropdownMenuCheckboxItem
					checked={layout.editorVisible}
					onCheckedChange={layout.setEditorVisible}
				>
					Editor
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={layout.rightVisible}
					onCheckedChange={layout.setRightVisible}
				>
					{consoleLesson ? "Preview" : "Right pane"}
				</DropdownMenuCheckboxItem>
				{!consoleLesson && (
					<DropdownMenuCheckboxItem
						checked={layout.bottomVisible}
						onCheckedChange={layout.setBottomVisible}
					>
						Driver Station / Console
					</DropdownMenuCheckboxItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={layout.reset}>Reset layout</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
