"""E-Rechnung ebInterface 6.1. Volle Schema-Prüfung, wenn EBINTERFACE_XSD gesetzt und lxml installiert ist."""

import os
import xml.etree.ElementTree as ET
from datetime import date

import pytest

from meit.einvoice import NS, split_address

N = {"e": NS}


def _issued_invoice(client):
    client.put("/api/billing/profile", json={"name": "ME-IT e.U.", "address": "Hauptplatz 1\n4020 Linz",
                                             "uid": "ATU12345678", "iban": "AT61 1904 3002 3457 3201", "bic": "BKAUATWW"})
    client.put("/api/customers/3", json={"name": "Maschinenbau Steiner GmbH", "address": "Industriezeile 7, 8700 Leoben",
                                         "uid": "ATU87654321", "supplier_no": "LIEF-4711", "employees": 65})
    client.post("/api/time", json={"customer_id": 3, "minutes": 95, "description": "Server-Check"})
    client.post("/api/billing/run", json={"period": date.today().strftime("%Y-%m")})
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Maschinenbau"))
    assert client.get(f"/api/invoices/{inv['id']}/ebinterface.xml").status_code == 422  # Entwurf
    client.put(f"/api/invoices/{inv['id']}", json={"order_ref": "4500012345"})
    client.put(f"/api/invoices/{inv['id']}", json={"status": "gestellt"})
    return inv


def test_split_address():
    assert split_address("Ringstraße 5, 1010 Wien") == {"street": "Ringstraße 5", "zip": "1010", "town": "Wien"}
    assert split_address("Hauptplatz 1\nA-4020 Linz") == {"street": "Hauptplatz 1", "zip": "4020", "town": "Linz"}
    assert split_address("") == {"street": "", "zip": "0000", "town": "unbekannt"}


def test_ebinterface_content(client):
    inv = _issued_invoice(client)
    r = client.get(f"/api/invoices/{inv['id']}/ebinterface.xml")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    root = ET.fromstring(r.content)
    assert root.tag == f"{{{NS}}}Invoice" and root.get("InvoiceCurrency") == "EUR"
    assert root.find("e:Biller/e:VATIdentificationNumber", N).text == "ATU12345678"
    assert root.find("e:Biller/e:InvoiceRecipientsBillerID", N).text == "LIEF-4711"
    assert root.find("e:InvoiceRecipient/e:OrderReference/e:OrderID", N).text == "4500012345"
    assert root.find("e:InvoiceRecipient/e:Address/e:ZIP", N).text == "8700"
    lines = root.findall("e:Details/e:ItemList/e:ListLineItem", N)
    assert len(lines) == 2 and lines[0].find("e:Quantity", N).get("Unit") == "HUR"
    net = sum(float(li.find("e:LineItemAmount", N).text) for li in lines)
    assert round(net, 2) == float(root.find("e:Tax/e:TaxItem/e:TaxableAmount", N).text)
    assert root.find("e:PayableAmount", N).text == root.find("e:TotalGrossAmount", N).text
    assert root.find("e:PaymentMethod/e:UniversalBankTransaction/e:BeneficiaryAccount/e:IBAN", N).text == "AT611904300234573201"


@pytest.mark.skipif(not os.environ.get("EBINTERFACE_XSD"), reason="EBINTERFACE_XSD nicht gesetzt")
def test_ebinterface_schema_valid(client):
    etree = pytest.importorskip("lxml.etree")
    inv = _issued_invoice(client)
    schema = etree.XMLSchema(etree.parse(os.environ["EBINTERFACE_XSD"]))
    doc = etree.fromstring(client.get(f"/api/invoices/{inv['id']}/ebinterface.xml").content)
    assert schema.validate(doc), schema.error_log
