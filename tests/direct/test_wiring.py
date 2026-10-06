def test_three_contracts_deploy_and_point_at_each_other(stack):
    registry = stack["registry"]
    monitor = stack["monitor"]
    vault = stack["vault"]

    reg_wiring = registry.get_wiring()
    assert reg_wiring["monitor"] == monitor.address
    assert reg_wiring["vault"] == vault.address

    mon_wiring = monitor.get_wiring()
    assert mon_wiring["registry"] == registry.address
    assert mon_wiring["vault"] == vault.address

    vault_wiring = vault.get_wiring()
    assert vault_wiring["registry"] == registry.address
    assert vault_wiring["monitor"] == monitor.address
