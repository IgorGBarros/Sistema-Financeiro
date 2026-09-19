from django.apps import AppConfig


class CartoesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.cartoes"
    label = "cartoes"
    verbose_name = "Cartões de crédito"

    def ready(self):
        # Import com efeito colateral: registra os receivers.
        from apps.cartoes import signals  # noqa: F401
