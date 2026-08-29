from django.apps import AppConfig


class FiscalConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.fiscal"
    label = "fiscal"
    verbose_name = "Notas fiscais"

    def ready(self):
        # Import com efeito colateral: registra os receivers.
        from apps.fiscal import signals  # noqa: F401
