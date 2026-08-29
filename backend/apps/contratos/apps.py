from django.apps import AppConfig


class ContratosConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.contratos"
    label = "contratos"
    verbose_name = "Contratos previstos"

    def ready(self):
        # Import com efeito colateral: registra os receivers.
        from apps.contratos import signals  # noqa: F401
