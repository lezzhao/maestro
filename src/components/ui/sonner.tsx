import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-bg-surface group-[.toaster]:text-text-main group-[.toaster]:border-border-muted group-[.toaster]:shadow-md group-[.toaster]:rounded-sm",
          description: "group-[.toast]:text-text-muted",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-bg-base group-[.toast]:font-bold group-[.toast]:text-[11px] group-[.toast]:uppercase group-[.toast]:tracking-wider",
          cancelButton:
            "group-[.toast]:bg-bg-elevated group-[.toast]:text-text-muted group-[.toast]:text-[11px] group-[.toast]:uppercase group-[.toast]:font-bold",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
