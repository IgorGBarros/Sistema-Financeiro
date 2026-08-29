"""
Autenticação.

Três caminhos, nesta ordem de precedência (montada em settings.AUTENTICADORES):

  1. FirebaseAuthentication — o frontend faz login no Firebase e manda o ID
     token em `Authorization: Bearer <token>`. Só entra na lista quando
     FIREBASE_CREDENTIALS_PATH está configurado.
  2. JWTAuthentication (SimpleJWT) — para integrações máquina-a-máquina que
     não passam pelo Firebase: cron de refresh, webhook do Asaas.
  3. AutenticacaoDesenvolvimento — só existe com DEBUG=1 e sem Firebase.
     Loga como um usuário fixo para você conseguir rodar `runserver` e abrir a
     API no primeiro minuto, sem precisar criar projeto no Firebase.

O import do firebase_admin é adiado de propósito. Se fosse feito no topo do
módulo, o projeto inteiro deixaria de subir numa máquina sem a biblioteca — e o
modo de desenvolvimento não precisa dela.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import authentication, exceptions

logger = logging.getLogger(__name__)
User = get_user_model()

USUARIO_DEV = "dev@local"


def _garantir_workspace(usuario, nome_sugerido: str):
    """Todo usuário novo nasce com workspace e o plano de contas base."""
    from apps.accounts.services.seed import criar_workspace_padrao

    if not usuario.workspaces.exists():
        criar_workspace_padrao(usuario, nome=nome_sugerido)


class FirebaseAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def _app(self):
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credentials.Certificate(settings.FIREBASE_CREDENTIALS)
            )
        return firebase_admin.get_app()

    def authenticate(self, request):
        cabecalho = authentication.get_authorization_header(request).split()
        if not cabecalho or cabecalho[0].lower() != self.keyword.lower().encode():
            return None
        if len(cabecalho) != 2:
            raise exceptions.AuthenticationFailed("Header Authorization malformado.")

        from firebase_admin import auth as firebase_auth

        token = cabecalho[1].decode()
        try:
            dados = firebase_auth.verify_id_token(token, app=self._app())
        except firebase_auth.ExpiredIdTokenError as exc:
            raise exceptions.AuthenticationFailed(
                "Sua sessão expirou. Entre novamente."
            ) from exc
        except firebase_auth.RevokedIdTokenError as exc:
            raise exceptions.AuthenticationFailed("Sessão revogada.") from exc
        except Exception as exc:
            # O SimpleJWT também usa "Bearer". Se o token não for do Firebase,
            # devolvemos None para o próximo autenticador tentar.
            logger.debug("Token não validado pelo Firebase: %s", exc)
            return None

        usuario, _ = User.objects.get_or_create(
            username=dados["uid"],
            defaults={
                "email": dados.get("email", ""),
                "first_name": (dados.get("name") or "")[:150],
            },
        )
        _garantir_workspace(
            usuario, f"Finanças de {dados.get('name') or dados.get('email') or 'você'}"
        )
        return (usuario, dados)


class AutenticacaoDesenvolvimento(authentication.BaseAuthentication):
    """
    Atalho de desenvolvimento. Nunca entra na lista com DEBUG=0 nem quando o
    Firebase está configurado — a checagem fica em settings, e é repetida aqui
    de propósito: este é o tipo de código que não pode vazar para produção
    por um erro de configuração.
    """

    def authenticate(self, request):
        if not settings.DEBUG or settings.FIREBASE_CREDENTIALS:
            return None

        usuario, criado = User.objects.get_or_create(
            username=USUARIO_DEV, defaults={"email": USUARIO_DEV, "is_staff": True}
        )
        if criado:
            usuario.set_unusable_password()
            usuario.save(update_fields=["password"])
        _garantir_workspace(usuario, "Minhas finanças")
        return (usuario, None)
