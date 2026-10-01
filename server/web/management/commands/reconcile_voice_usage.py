import logging
import time

from django.core.management.base import BaseCommand, CommandError

from web.voice import reconcile

log = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Reconcile Crema voice provider usage (Soniox, correction keys) without retaining dictated content."

    def add_arguments(self, parser):
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--days", type=int, default=2)

    def handle(self, *args, **options):
        while True:
            try:
                self.stdout.write(str(reconcile(options["days"])))
            except Exception as error:
                # Credential and HTTP bodies are deliberately excluded.
                if not options["watch"]:
                    raise CommandError(type(error).__name__) from None
                log.error("Crema voice reconciliation requires attention: %s", type(error).__name__)
            if not options["watch"]:
                break
            time.sleep(15)
