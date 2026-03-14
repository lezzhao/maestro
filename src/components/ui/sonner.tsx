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
            "group toast group-[.toaster]:bg-bg-surface group-[.toaster]:text-text-main group-[.toaster]:border-border-muted group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-text-muted",
          actionButton:
            "group-[.toast]:bg-primary-500 group-[.toast]:text-white group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:bg-bg-elevated group-[.toast]:text-text-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
