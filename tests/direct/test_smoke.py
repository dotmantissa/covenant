def test_registry_deploys_and_stores_a_facility(registry, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    registry.create_facility(
        "demo-1",
        direct_bob.as_hex,
        "Harbour DAO",
        "Working capital",
        250_000 * 10**18,
        850,
        300,
        "https://rpc.example.org",
        "0x" + "11" * 20,
        "https://forum.example.org",
    )
    facility = registry.get_facility("demo-1")
    print("FACILITY:", facility)
    assert facility["borrower_name"] == "Harbour DAO"
    assert facility["covenant_count"] == 0
