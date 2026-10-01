from django.db import migrations

# Grades become Thock-style access kinds (docs: Crema-이용권-권한-Thock방식-계획-2026-10-01.md).
KIND_OF_GRADE = {"paid": "standard", "staff": "employee", "gift": "partner", "admin": "owner"}


def grades_to_kinds(apps, schema_editor):
    Membership = apps.get_model("web", "Membership")
    for grade, kind in KIND_OF_GRADE.items():
        Membership.objects.filter(kind=grade).update(kind=kind)


def kinds_to_grades(apps, schema_editor):
    Membership = apps.get_model("web", "Membership")
    for grade, kind in KIND_OF_GRADE.items():
        Membership.objects.filter(kind=kind).update(kind=grade)
    Membership.objects.filter(kind__in=["trial", "plus"]).update(kind="paid")
    # full_access comes back (0007 reversed first) with its default; every grade but free had full use.
    Membership.objects.exclude(kind="free").update(full_access=True)


class Migration(migrations.Migration):
    dependencies = [("web", "0005_model_usage")]

    operations = [
        migrations.RenameField("membership", "grade", "kind"),
        migrations.RunPython(grades_to_kinds, kinds_to_grades),
    ]
