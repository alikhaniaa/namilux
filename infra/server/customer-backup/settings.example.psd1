@{
    ServerHost = '203.0.113.20'
    # Use the customer's own authorized SSH key. Never include the key in this folder/ZIP.
    SshKeyPath = 'C:\Users\YOUR_NAME\.ssh\namilux_customer'
    KnownHostsPath = 'C:\Users\YOUR_NAME\.ssh\known_hosts'
    # Public age recipient only. The AGE-SECRET-KEY file must stay outside the server and this ZIP.
    Recipient = 'PASTE_YOUR_AGE_PUBLIC_RECIPIENT_HERE'
    Destination = 'C:\Users\YOUR_NAME\Documents\NamiluxBackups'
    # Optional only when this PC needs a particular outbound interface; normally leave absent.
    # BindAddress = '192.168.1.100'
}
