from django.urls import path

from apps.previsao import views

urlpatterns = [
    path("previsao/", views.PrevisaoView.as_view(), name="previsao"),
    path("previsao/modelos/", views.ModelosView.as_view(), name="previsao-modelos"),
]
