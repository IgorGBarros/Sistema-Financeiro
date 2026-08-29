from django.apps import AppConfig


class RealizadosConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.realizados"
    label = "realizados"
    verbose_name = "Lançamentos realizados"

    def ready(self):
        # Import com efeito colateral: registra os receivers.
        from apps.realizados import signals  # noqa: F401
